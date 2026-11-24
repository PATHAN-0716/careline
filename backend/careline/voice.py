import asyncio
import os
from datetime import date as CalendarDate
from uuid import uuid4

from fastapi import BackgroundTasks
from loguru import logger
from pydantic import BaseModel, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from pipecat.adapters.llm.schemas.function_schema import FunctionSchema
from pipecat.adapters.llm.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import (
    AggregatedTextProgressFrame, BotStoppedSpeakingFrame, InputTransportMessageFrame,
    InterimTranscriptionFrame, InterruptionFrame,
    LLMFullResponseStartFrame, LLMRunFrame, TTSSpeakFrame, TTSTextFrame, TranscriptionFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineWorker, ProcessorUnusablePolicy
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair, LLMUserAggregatorParams
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.frameworks.rtvi.observer import RTVIObserverParams
from pipecat.processors.frameworks.rtvi.processor import RTVIProcessor
from pipecat.services.elevenlabs.stt import ElevenLabsRealtimeSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.google.llm import GoogleLLMService
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.request_handler import SmallWebRTCPatchRequest, SmallWebRTCRequest, SmallWebRTCRequestHandler
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.workers.runner import WorkerRunner

from careline.identity import PHONE, Confirmation, redact
from careline.store import clinic_today, now

handler = SmallWebRTCRequestHandler()
PROMPT = """You are Careline Assistant, a warm and concise voice scheduling assistant.
Ask one question at a time. Help with scheduling only. Use the availability tool to offer
at most three slots. For booking, use the exact slot ID from availability results after
the caller selects it. A choice like "the earliest slot you offered" is a selection.
When availability returns no slots, help the caller clarify the doctor, specialty, or date.
Dates and times are Asia/Kolkata.
When the backend returns phone_required, ask the caller to say their phone number.
The backend handles reading back and verifying phone numbers. Never ask for names or OTPs.
After confirmation, resume a booking or cancellation only if the caller actually requested it.
If the caller provided a number before requesting an action, ask how you can help.
If cancellation returns select_appointment, describe the matching visits and ask which one.
Never claim a booking or cancellation succeeded until its tool returns the updated record.
Times returned by tools are UTC ISO timestamps. Convert to India time when speaking them.
"""


class Availability(BaseModel):
    doctor: str | None = Field(None, max_length=100)
    specialty: str | None = Field(None, max_length=100)
    date: CalendarDate | None = None


class Booking(BaseModel):
    slot_id: str = Field(min_length=1, max_length=100)


class Cancellation(BaseModel):
    reference: str | None = Field(None, max_length=30)


TOOL_DEFS = [
    ("check_doctor_availability", "Look up available doctor slots by doctor name, specialty, or ISO date.",
     Availability, {"doctor": "Doctor name or ID", "specialty": "Specialty", "date": "YYYY-MM-DD"}, []),
    ("book_appointment", "Book the selected available slot for the verbally confirmed caller.",
     Booking, {"slot_id": "Exact slot ID from availability"}, ["slot_id"]),
    ("cancel_appointment", "Cancel a future visit for the confirmed caller, optionally by appointment reference.",
     Cancellation, {"reference": "Appointment reference when the caller picks from multiple matches"}, []),
]


class VoiceControls(RTVIProcessor):
    async def process_frame(self, frame, direction):
        if isinstance(frame, InputTransportMessageFrame):
            message = frame.message
            if not isinstance(message, dict) or message.get("type") not in {"client-ready", "client-message"}:
                return
        await super().process_frame(frame, direction)


class Conversation:
    def __init__(self, store, session_id, secret):
        self.store = store
        self.session_id = session_id
        self.identity = Confirmation(secret)
        self.collecting = False
        self.readback = "idle"
        self.turn = uuid4().hex

    async def send(self, kind, payload, *, persist=True, dashboard=False):
        if persist:
            event = await run_in_threadpool(self.store.event, self.session_id, kind, payload, dashboard)
            if dashboard:
                self.store.notify_dashboard()
        else:
            event = {"id": uuid4().hex, "sessionId": self.session_id, "type": kind, "timestamp": now(), "payload": payload}
        await self.worker.rtvi.send_server_message(event)

    async def transcript(self, speaker, text, turn_id=None, final=True):
        await self.send("transcript", {"speaker": speaker, "turnId": turn_id or uuid4().hex,
                                      "text": redact(text), "final": final}, persist=final)

    async def tool(self, params):
        name = params.function_name
        action = {"check_doctor_availability": "availability_check", "book_appointment": "booking",
                  "cancel_appointment": "cancellation"}[name]
        action_id = params.tool_call_id
        await self.send(action + "_started", {"actionId": action_id})
        try:
            model = next(row[2] for row in TOOL_DEFS if row[0] == name)
            args = model.model_validate(params.arguments)
            if isinstance(args, Availability):
                slots = await run_in_threadpool(self.store.slots, args.doctor, args.specialty, args.date, True)
                result = {"date": args.date.isoformat() if args.date else None, "slots": slots[:12]}
                await self.send("availability_check_completed", {"actionId": action_id, **result}, dashboard=True)
            elif not self.identity.confirmed or self.collecting:
                self.collecting = True
                result = {"error": "phone_required"}
                await self.send("phone_confirmation_required", {})
            else:
                identity = self.identity.confirmed
                if isinstance(args, Booking):
                    result, event = await run_in_threadpool(self.store.book, self.session_id, args.slot_id, identity, action_id)
                else:
                    result, event = await run_in_threadpool(self.store.cancel, self.session_id, identity, args.reference, action_id)
                if event:
                    self.store.notify_dashboard()
                    await self.worker.rtvi.send_server_message(event)
        except ValidationError:
            result = {"error": "invalid_arguments"}
        except Exception:
            logger.warning("Scheduling tool failed for session {}", self.session_id)
            result = {"error": "scheduling_unavailable"}
        if "error" in result:
            await self.send("tool_failed", {"actionId": action_id, "action": action, "code": result["error"]})
        await params.result_callback(result)


class CallerInput(FrameProcessor):
    def __init__(self, call, context):
        super().__init__()
        self.call = call
        self.context = context

    async def speak(self, text, display=None):
        await self.call.transcript("assistant", display or text)
        await self.push_frame(TTSSpeakFrame(text, append_to_context=False, text_type="careline-direct"))

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        call = self.call
        if isinstance(frame, InterruptionFrame) and call.readback in {"queued", "played"}:
            call.readback = "interrupted"
            call.identity.awaiting = False
        if direction == FrameDirection.UPSTREAM:
            await self.push_frame(frame, direction)
            return
        if isinstance(frame, InterimTranscriptionFrame):
            if not call.collecting and not any(char.isdigit() for char in frame.text):
                # Hold interim text if it contains digit words. A partial may be only the first digits.
                if not PHONE.search(frame.text):
                    await call.transcript("caller", frame.text, call.turn, False)
            return
        if isinstance(frame, TranscriptionFrame):
            if not frame.text.strip():
                return
            step = call.identity.process(frame.text, call.collecting)
            visible = redact(frame.text)
            if step in {"readback", "repeat"}:
                visible = "Phone number provided" if step == "readback" else "Confirmation response"
            elif step == "retry":
                visible = "Phone number needs clarification"
            await call.transcript("caller", visible, call.turn)
            call.turn = uuid4().hex
            if step in {"readback", "repeat"}:
                call.collecting = True
                call.identity.awaiting = False
                call.readback = "queued"
                number = call.identity.candidate
                await call.send("phone_confirmation_required", {"phone_tail": number[-4:]})
                await self.speak("I heard " + ", ".join(number.lstrip("+")) + ". Is that correct?",
                                 f"I heard a number ending in {number[-4:]}. Is that correct?")
                return
            if step == "retry":
                await self.speak("Please say your complete phone number, including the area code if needed.")
                return
            if step == "confirmed":
                call.collecting = False
                tail = call.identity.confirmed.tail
                await run_in_threadpool(call.store.confirm_session, call.session_id, tail)
                await call.send("phone_confirmed", {"phone_tail": tail})
                self.context.add_message({"role": "user", "content": (
                    "The caller verbally confirmed their phone number. If they have already requested "
                    "a specific scheduling action, continue that request. Otherwise acknowledge the "
                    "confirmation and ask how you can help with appointments."
                )})
                await self.push_frame(LLMRunFrame())
                return
            frame.text = visible
        await self.push_frame(frame, direction)


class AgentOutput(FrameProcessor):
    def __init__(self, call):
        super().__init__()
        self.call = call
        self.spoken = ""
        self.segment = None
        self.turn = uuid4().hex

    async def flush(self):
        if self.spoken:
            await self.call.transcript("assistant", self.spoken, self.turn)
        self.spoken = ""
        self.segment = None
        self.turn = uuid4().hex

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if direction == FrameDirection.DOWNSTREAM:
            if isinstance(frame, LLMFullResponseStartFrame):
                await self.call.send("agent_state", {"state": "Thinking"}, persist=False)
            if isinstance(frame, BotStoppedSpeakingFrame):
                if self.call.readback == "played":
                    self.call.readback = "idle"
                    self.call.identity.readback_finished()
                await self.flush()
            if isinstance(frame, InterruptionFrame):
                await self.flush()
            if (
                isinstance(frame, AggregatedTextProgressFrame)
                and frame.text_type == "careline-direct"
                and not frame.remaining_text.strip()
                and self.call.readback == "queued"
                and "correct" in frame.text.lower()
            ):
                self.call.readback = "played"
            if isinstance(frame, TTSTextFrame) and frame.text.strip():
                # Timestamped words use TextType.WORD even for a custom TTSSpeakFrame.
                # Its append_to_context flag still identifies our private speech.
                if frame.text_type == "careline-direct" or frame.append_to_context is False:
                    if self.call.readback == "queued" and "correct" in frame.text.lower():
                        self.call.readback = "played"
                else:
                    if self.spoken and self.segment != frame.segment_id:
                        await self.flush()
                    self.segment = frame.segment_id
                    self.spoken = (self.spoken + " " + frame.text.strip()).strip()
                    if not PHONE.search(self.spoken):
                        await self.call.transcript("assistant", self.spoken, self.turn, False)
        await self.push_frame(frame, direction)


async def run_call(connection, store, secret):
    session_id = uuid4().hex
    await run_in_threadpool(store.start_session, session_id)
    call = Conversation(store, session_id, secret)
    runner = WorkerRunner(handle_sigint=False)
    outcome = "failed"
    try:
        transport = SmallWebRTCTransport(webrtc_connection=connection,
                                         params=TransportParams(audio_in_enabled=True, audio_out_enabled=True))
        doctors = await run_in_threadpool(store.doctors)
        stt = ElevenLabsRealtimeSTTService(
            api_key=os.environ["ELEVENLABS_API_KEY"],
            settings=ElevenLabsRealtimeSTTService.Settings(
                keyterms=[doctor["name"] for doctor in doctors],
            ),
        )
        tts = ElevenLabsTTSService(api_key=os.environ["ELEVENLABS_API_KEY"], settings=ElevenLabsTTSService.Settings(
            voice=os.environ["ELEVENLABS_VOICE_ID"], model="eleven_flash_v2_5"))
        llm = GoogleLLMService(api_key=os.environ["GOOGLE_API_KEY"], settings=GoogleLLMService.Settings(
            model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
            system_instruction=PROMPT + f" Today is {clinic_today().isoformat()}."))
        tools = ToolsSchema(standard_tools=[
            FunctionSchema(name=name, description=description, properties={
                key: {"type": "string", "description": value} for key, value in fields.items()
            }, required=required)
            for name, description, _, fields, required in TOOL_DEFS
        ])
        for name, *_ in TOOL_DEFS:
            llm.register_function(name, call.tool, cancel_on_interruption=False)
        context = LLMContext(tools=tools)
        user, assistant = LLMContextAggregatorPair(context, user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer()))
        worker = PipelineWorker(Pipeline([
            transport.input(), stt, CallerInput(call, context), user, llm, tts,
            transport.output(), AgentOutput(call), assistant,
        ]), processor_unusable_policy=ProcessorUnusablePolicy.END, rtvi_processor=VoiceControls(),
            rtvi_observer_params=RTVIObserverParams(
            user_transcription_enabled=False, user_input_enabled=False, user_llm_enabled=False,
            bot_output_enabled=False, bot_tts_enabled=False, bot_llm_enabled=False, metrics_enabled=False,
        ))
        call.worker = worker

        @worker.rtvi.event_handler("on_client_ready")
        async def ready(rtvi):
            nonlocal outcome
            if outcome == "failed":
                outcome = "disconnected"
                event = await run_in_threadpool(store.transition, session_id, "connected")
                store.notify_dashboard()
                await rtvi.send_server_message(event)
                context.add_message({"role": "developer", "content": "Greet the caller and ask how you can help with appointments."})
                await worker.queue_frames([LLMRunFrame()])

        @worker.rtvi.event_handler("on_client_message")
        async def client_message(rtvi, message):
            nonlocal outcome
            if message.type == "end-call":
                outcome = "ended"
                await run_in_threadpool(store.transition, session_id, outcome)
                store.notify_dashboard()
                await rtvi.send_server_response(message, {"ended": True})
                await runner.cancel()

        @transport.event_handler("on_client_disconnected")
        async def disconnected(_transport, _client):
            await runner.cancel()

        await runner.add_workers(worker)
        await asyncio.wait_for(runner.run(), timeout=900)
    except Exception:
        outcome = "failed"
        logger.warning("Voice session {} stopped before normal completion", session_id)
    finally:
        if await run_in_threadpool(store.transition, session_id, outcome):
            store.notify_dashboard()


def install_voice(app, store):
    @app.post("/api/offer")
    async def offer(request: SmallWebRTCRequest, background_tasks: BackgroundTasks):
        async def connected(connection):
            background_tasks.add_task(run_call, connection, store, app.state.identity_key)

        return await handler.handle_web_request(request=request, webrtc_connection_callback=connected)

    @app.patch("/api/offer")
    async def patch_offer(request: SmallWebRTCPatchRequest):
        await handler.handle_patch_request(request)
        return {"status": "ok"}
