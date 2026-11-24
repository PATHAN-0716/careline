import asyncio
import json
from types import SimpleNamespace

from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription
from pipecat.processors.frame_processor import FrameProcessor

from careline import voice
from careline.store import Store


class ProviderStub(FrameProcessor):
    Settings = SimpleNamespace

    def __init__(self, **_options):
        super().__init__()

    def register_function(self, *_args, **_options):
        pass

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        await self.push_frame(frame, direction)


def test_small_webrtc_handshake_and_hangup(tmp_path, monkeypatch):
    """Exercise real local RTC signaling, the pipeline worker, and RTVI controls."""
    for name in ("ElevenLabsRealtimeSTTService", "ElevenLabsTTSService", "GoogleLLMService"):
        monkeypatch.setattr(voice, name, ProviderStub)
    for key in ("ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "GOOGLE_API_KEY"):
        monkeypatch.setenv(key, "offline-test")
    store = Store(str(tmp_path / "rtc.sqlite3"))
    store.initialize()

    async def call():
        router = voice.SmallWebRTCRequestHandler()
        peer = RTCPeerConnection(RTCConfiguration(iceServers=[]))
        peer.addTransceiver("audio", direction="sendrecv")
        messages = asyncio.Queue()
        workers = []
        channel = peer.createDataChannel("rtvi-ai")

        @channel.on("open")
        def opened():
            channel.send(json.dumps({"label": "rtvi-ai", "type": "client-ready", "id": "ready",
                                     "data": {"version": "2.3.0"}}))

        @channel.on("message")
        def received(raw):
            messages.put_nowait(json.loads(raw))

        async def launch(connection):
            workers.append(asyncio.create_task(voice.run_call(connection, store, b"test")))

        async def next_type(message_type):
            while message := await asyncio.wait_for(messages.get(), timeout=8):
                if message.get("type") == message_type:
                    return message

        try:
            await peer.setLocalDescription(await peer.createOffer())
            answer = await router.handle_web_request(
                request=voice.SmallWebRTCRequest(sdp=peer.localDescription.sdp, type=peer.localDescription.type),
                webrtc_connection_callback=launch,
            )
            await peer.setRemoteDescription(RTCSessionDescription(sdp=answer["sdp"], type=answer["type"]))
            await next_type("bot-ready")
            event = await next_type("server-message")
            assert event["data"]["type"] == "call_connected"
            channel.send(json.dumps({"label": "rtvi-ai", "type": "client-message", "id": "end",
                                     "data": {"t": "end-call", "d": {}}}))
            await asyncio.wait_for(asyncio.gather(*workers), timeout=8)
            sessions = store.sessions()
            assert len(sessions) == 1
            assert sessions[0]["outcome"] == "ended"
            assert [row["type"] for row in store.events(session=sessions[0]["id"])] == ["call_connected", "call_ended"]
        finally:
            await peer.close()
            await router.close()
            for worker in workers:
                if not worker.done():
                    worker.cancel()
            await asyncio.gather(*workers, return_exceptions=True)

    asyncio.run(asyncio.wait_for(call(), timeout=30))
