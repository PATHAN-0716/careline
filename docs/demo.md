# Three-minute Careline demo

Use localhost and configure both service keys and an ElevenLabs voice ID before recording. Check that the dashboard says **Voice ready** and that your microphone and browser audio work. Open the Doctors directory and confirm Dr. Anika Rao has at least one available slot tomorrow. Start from Overview.

| Time | What to show and say |
| --- | --- |
| 00:00–00:20 | Show the dashboard and start the call with **Try Call**. |
| 00:20–00:50 | After the greeting, say “My demo phone number is nine eight seven six five four three two one zero.” Wait for readback and say “Yes, that’s correct.” |
| 00:50–01:25 | Ask “What openings does Dr. Anika Rao have tomorrow?” Show the live transcript and availability result. |
| 01:25–02:10 | Verbally select one of the exact offered times. Wait for the confirmation ticket and dashboard update. Open the appointment from the ticket if time permits. |
| 02:10–02:40 | End the call and show the post-call summary. |

Before recording, separately test checking availability, booking, and cancelling in a single call. For cancellation, ask to cancel the visit you just booked, specify the visit verbally if prompted, then verify the appointment remains visible as cancelled and the slot reopens.

For submission, use the GitHub repository link, the recording up to three minutes, and the short description below. Review the description in your own words.

> The browser sends microphone audio to Pipecat over WebRTC. ElevenLabs transcribes it, and Gemini calls Python tools to check, book, or cancel appointments in SQLite. The server requires spoken phone confirmation before writes. ElevenLabs speaks the response, and committed events update the dashboard as the call runs.
