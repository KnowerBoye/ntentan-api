# Ntentan API

WebSocket API server for medication scanning and medical assistant services, powered by Google Gemini AI.

---

## 🔐 Authentication

### HTTP Endpoints
All HTTP endpoints (e.g. `/api/assistant/chat`) require Firebase JWT authentication via the `Authorization` header.

| Method | Location | Example |
| :----- | :------- | :------ |
| Bearer token | `Authorization` header | `Authorization: Bearer <FIREBASE_ID_TOKEN>` |

### WebSocket Namespaces
All WebSocket namespaces require **Firebase JWT authentication**. The token is verified on every connection.

| Method | Location | Example |
| :----- | :------- | :------ |
| Handshake auth | `socket.handshake.auth.token` | `{ auth: { token: "<FIREBASE_ID_TOKEN>" } }` |
| Query parameter | URL `?token=` | `io("SERVER/med-scanner?token=<FIREBASE_ID_TOKEN>")` |

### Failure

If the token is missing or invalid, the connection or request is rejected with an appropriate error.

---

## 📷 Medication Scanner (WebSocket)

The `med-scanner` namespace provides real-time medication label scanning. The client streams camera frames, and the server uses Gemini 2.5 Flash to provide positioning feedback until the label is successfully read, then performs vector similarity search against the user's saved medications.

### **Endpoint**
```
WS /med-scanner
```

> **Note:** Since authentication is applied globally, you **must** provide a valid Firebase JWT token.

### **Workflow**

```
┌──────────┐    Binary JPEG    ┌──────────────────┐    JSON response     ┌──────────┐
│  Client  │ ─── frame ──────→ │  MedScanner      │ ─── response ─────→  │  Client  │
│          │                   │  (Gemini 2.5)    │                      │          │
└──────────┘                   └──────────────────┘                      └──────────┘
```

1. **Connect**: Client connects with Firebase JWT authentication.
2. **Stream**: Client emits `frame` events containing binary JPEG chunks.
3. **Buffer**: Server accumulates up to **5 frames** or waits **800ms** before processing.
4. **Inference**: Gemini 2.5 Flash analyzes frames with a structured JSON schema.
5. **Feedback**: Server emits positioning instructions (`move_closer`, `rotate_left`, etc.).
6. **Match** (on `success`): Extracted label fields are used to vector-search the user's Firestore medications collection.

### **Events**

#### Client → Server

| Event | Data Type | Description |
| :---- | :-------- | :---------- |
| `frame` | `{ buf: ArrayBuffer }` | JPEG image binary data |

#### Server → Client

| Event | Data Type | Description |
| :---- | :-------- | :---------- |
| `response` | `string` (JSON) | Parsed by the client with `JSON.parse()` |

### **Response Schema**

The response is a discriminated union keyed by the `status` field. The server emits a **JSON string** — the client **must** call `JSON.parse()` on it.

#### `processing`
Emitted when frame processing begins.

```json
{ "status": "processing" }
```

| Field | Type | Description |
| :---- | :--- | :---------- |
| `status` | `"processing"` | Indicates inference has started |

#### `positioning` / `no_object`
Emitted when a label is visible but not readable, or when no medication is detected.

```json
{
  "status": "positioning",
  "instruction": "move_closer",
  "guidance_text": "Move the camera closer to the label."
}
```

| Field | Type | Description |
| :---- | :--- | :---------- |
| `status` | `"positioning"` or `"no_object"` | Whether something is visible |
| `instruction` | `string` | Movement command (see below) |
| `guidance_text` | `string` | User-friendly instruction |

**Valid Instructions:**

| Instruction | Meaning |
| :---------- | :------ |
| `move_up` | Move the bottle up |
| `move_down` | Move the bottle down |
| `move_left` | Move the bottle left |
| `move_right` | Move the bottle right |
| `rotate_left` | Rotate bottle counter-clockwise |
| `rotate_right` | Rotate bottle clockwise |
| `flip` | Flip the bottle over |
| `move_closer` | Bring the bottle closer |
| `move_farther` | Move the bottle farther away |
| `hold_still` | Keep the bottle steady |
| `none` | No instruction needed |

#### `success`
Emitted when the label is fully read and the medication is identified. The server also performs a vector search against the user's saved medications.

```json
{
  "status": "success",
  "instruction": "none",
  "guidance_text": "Label read successfully. Found Ibuprofen 200mg.",
  "prescription_match": {
    "medication": {
      "completedSlots": ["08:00", "20:00"],
      "composite_string": "Ibuprofen 200mg tablet analgesic",
      "createdAt": "2025-12-01T10:00:00.000Z",
      "dosage": "200mg",
      "frequency": 2,
      "id": "abc123",
      "instruction": "Take with food",
      "name": "Ibuprofen",
      "strength": "200mg",
      "timeSlots": ["08:00", "20:00"],
      "unitsPerDose": 1,
      "updatedAt": "2025-12-01T10:00:00.000Z"
    },
    "distance": 0.12,
    "withinThreshold": true
  }
}
```

| Field | Type | Description |
| :---- | :--- | :---------- |
| `status` | `"success"` | Label successfully read |
| `instruction` | `"none"` | Always `"none"` on success |
| `guidance_text` | `string` | Confirmation message |
| `prescription_match` | `object` or `null` | Best matching medication from user's records |

**`prescription_match` fields:**

| Field | Type | Description |
| :---- | :--- | :---------- |
| `medication` | `object` | Full medication document from Firestore |
| `distance` | `number` | Cosine vector distance (0 = perfect, lower is better) |
| `withinThreshold` | `boolean` | `true` if distance ≤ 0.3 |

If no confident match is found, `prescription_match` is `null`.

#### Error Event

| Event | Payload | Description |
| :---- | :------ | :---------- |
| `error` | `string` | Error message from the server |

---

### **Example: JavaScript (Socket.IO Client)**

```javascript
import { io } from "socket.io-client";

// Authenticate with Firebase JWT token
const socket = io("https://your-server.com/med-scanner", {
  auth: { token: "<FIREBASE_ID_TOKEN>" },
  transports: ["websocket"],
});

// ── Stream frames from a <video> element ─────────────────────
const video = document.getElementById("video");
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");

async function startScanning() {
  // Start camera
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
  });
  video.srcObject = stream;
  await video.play();

  // Capture and send frames every 600ms
  setInterval(() => {
    if (socket.connected) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      canvas.toBlob((blob) => {
        blob.arrayBuffer().then((buf) => {
          socket.emit("frame", { buf });
        });
      }, "image/jpeg", 0.8);
    }
  }, 600);
}

// ── Handle server responses ──────────────────────────────────
socket.on("response", (jsonString) => {
  const data = JSON.parse(jsonString);

  switch (data.status) {
    case "processing":
      console.log("⏳ Processing frames...");
      break;

    case "positioning":
    case "no_object":
      console.log(`📐 ${data.instruction} — ${data.guidance_text}`);
      // Show arrow/instruction UI to the user
      break;

    case "success":
      console.log(`✅ ${data.guidance_text}`);
      if (data.prescription_match) {
        console.log("Matched medication:", data.prescription_match.medication.name);
        console.log("Match confidence:", data.prescription_match.distance);
      }
      break;
  }
});

socket.on("error", (msg) => {
  console.error("Server error:", msg);
});
```

### **Example: Flutter (Dart)**

```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'dart:convert';
import 'dart:typed_data';

class MedScannerService {
  late IO.Socket _socket;

  /// Connect to the MedScanner WebSocket with Firebase auth
  void connect(String serverUrl, String firebaseToken) {
    _socket = IO.io(
      '$serverUrl/med-scanner',
      IO.OptionBuilder()
        .setAuth({'token': firebaseToken})
        .setTransports(['websocket'])
        .build(),
    );

    _socket.onConnect((_) => print('Connected to MedScanner'));
    _socket.onDisconnect((_) => print('Disconnected'));

    // Listen for responses
    _socket.on('response', (data) {
      // Data is a JSON string from the server
      _handleResponse(jsonDecode(data as String) as Map<String, dynamic>);
    });

    _socket.on('error', (msg) {
      print('Error: $msg');
    });
  }

  /// Send a JPEG image frame as binary
  void sendFrame(Uint8List jpegBytes) {
    if (_socket.connected) {
      _socket.emit('frame', {'buf': jpegBytes});
    }
  }

  void _handleResponse(Map<String, dynamic> response) {
    final String status = response['status'];

    switch (status) {
      case 'processing':
        print('⏳ Processing...');
        break;

      case 'positioning':
      case 'no_object':
        final instruction = response['instruction'] as String;
        final guidance = response['guidance_text'] as String;
        print('📐 $instruction — $guidance');
        // Update UI with instruction arrow
        break;

      case 'success':
        print('✅ ${response['guidance_text']}');
        final match = response['prescription_match'];
        if (match != null) {
          final med = match['medication'] as Map<String, dynamic>;
          print('Matched: ${med['name']} (${med['dosage']})');
        }
        break;
    }
  }

  void disconnect() {
    _socket.disconnect();
  }
}
```

---

## 🤖 Medical Assistant (REST API)

The assistant is available via an **HTTP REST endpoint** (no WebSocket). The client owns and sends the full conversation history with each request, making the API stateless and suitable for serverless environments.

### **Endpoint**

```
POST /api/assistant/chat
```

### **Headers**

| Header | Value | Required |
| :----- | :---- | :------- |
| `Authorization` | `Bearer <FIREBASE_ID_TOKEN>` | ✅ Yes |
| `Content-Type` | `application/json` | ✅ Yes |

### **Workflow**

```
┌──────────┐   POST /api/assistant/chat    ┌──────────────────┐   JSON response    ┌──────────┐
│  Client  │ ─── { query, history } ──────→ │  Assistant       │ ─── { message }  → │  Client  │
│          │                                │  (Gemini 2.5)    │                   │          │
└──────────┘                                └──────────────────┘                   └──────────┘
```

1. **Authenticate**: Attach Firebase JWT token as `Authorization: Bearer <token>`.
2. **Send**: `POST /api/assistant/chat` with the user's query and conversation history.
3. **Process**: The server handles Twi translation/transcription if needed, calls Gemini with tool access (prescription queries, drug info lookup).
4. **Response**: Server returns the AI response message. The client is responsible for persisting the conversation history and sending it with the next request.

### **Request Body**

```json
{
  "query": {
    "content": "What medications should I take this morning?",
    "type": "text"
  },
  "history": [
    {
      "content": "I have a headache",
      "type": "text",
      "role": "user",
      "language": "english"
    },
    {
      "content": "I'm sorry to hear that. Let me check your prescriptions for headache relief options.",
      "type": "text",
      "role": "assistant",
      "language": "english"
    }
  ],
  "language": "english"
}
```

| Field | Type | Description |
| :---- | :--- | :---------- |
| `query` | `object` | **Required.** The user's current message |
| `query.content` | `string` | The message text or **Base64-encoded** audio string |
| `query.type` | `string` | `"text"` or `"audio"` |
| `history` | `array` | **Optional.** Previous conversation messages (default `[]`) |
| `history[].content` | `string` | Message text |
| `history[].type` | `string` | `"text"` or `"audio"` |
| `history[].role` | `string` | `"user"` or `"assistant"` |
| `history[].language` | `string` | `"english"` or `"twi"` |
| `language` | `string` | Language of the current query: `"english"` or `"twi"` |

### **Response Schema**

**Status:** `200 OK`

#### English Response

When the query language is `"english"`:

```json
{
  "status": "success",
  "data": {
    "message": "Based on your prescriptions, you need to take:\n\n- **Metformin 500mg** — 1 tablet (Morning with breakfast)\n- **Lisinopril 10mg** — 1 tablet (Morning)\n\nRemember to take them with food! ⚕️",
    "history": [
      { "content": "...", "type": "text", "role": "user", "language": "english" },
      { "content": "Based on your prescriptions...", "type": "text", "role": "assistant", "language": "english" }
    ]
  }
}
```

#### Twi Response

When the query language is `"twi"`, the response includes an `audio` field containing a **Base64-encoded MP3** of the Twi text spoken aloud:

```json
{
  "status": "success",
  "data": {
    "message": "Sɛ wokura wo nnur a, ɛsɛ sɛ wogye...",
    "history": [
      { "content": "...", "type": "text", "role": "user", "language": "twi" },
      { "content": "Sɛ wokura wo nnur a...", "type": "text", "role": "assistant", "language": "twi" }
    ],
    "audio": "//uQxAAA... (Base64-encoded MP3)"
  }
}
```

| Field | Type | Description |
| :---- | :--- | :---------- |
| `status` | `string` | Always `"success"` |
| `data` | `object` | The response payload |
| `data.message` | `string` | The assistant's text response |
| `data.history` | `ChatMessage[]` | Updated conversation history (client should persist and send next time) |
| `data.audio` | `string` (Base64) | **Twi only.** Base64-encoded MP3 audio of the spoken Twi response |

### **Twi Language Support**

The assistant supports **bidirectional Twi ↔ English** translation for both text and audio inputs.

#### Input Processing

| Query Language | Query Type | Processing |
| :------------- | :--------- | :--------- |
| `english` | `text` | Sent directly to Gemini |
| `english` | `audio` | Transcribed via speech-to-text, then sent to Gemini |
| `twi` | `text` | Translated to English (Twi → English), then sent to Gemini |
| `twi` | `audio` | Transcribed to Twi text, then translated to English (Twi → English), then sent to Gemini |

#### Response Translation & Audio

The assistant's English response is automatically translated back to the user's input language. For Twi responses, the server also generates spoken audio via TTS.

| User Language | Response Language | Audio | Processing |
| :------------ | :---------------- | :---- | :--------- |
| `english` | English | ❌ None | Returned as-is |
| `twi` | Twi | ✅ Base64 MP3 (via `audio` field) | Translated English → Twi via Ghana NLP API, then synthesized to speech |

### **Example: JavaScript (Fetch API)**

```javascript
const API_BASE = "https://your-server.com";

/**
 * Send a message to the assistant and get a response.
 * The caller is responsible for persisting `history` and passing it
 * back on the next call to maintain conversation continuity.
 */
async function chatWithAssistant(
  firebaseToken,
  content,
  { type = "text", language = "english", history = [] } = {}
) {
  const res = await fetch(`${API_BASE}/api/assistant/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${firebaseToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: { content, type },
      history,
      language,
    }),
  });

  if (!res.ok) {
    throw new Error(`Assistant API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  return json.data.message;
}

// ── Usage ────────────────────────────────────────────────────

// Persist history across the session
let conversationHistory = [];

// First message
const response1 = await chatWithAssistant(
  "<FIREBASE_ID_TOKEN>",
  "What medications should I take this morning?",
  { history: conversationHistory }
);

console.log("Assistant:", response1);

// Manually append to history
conversationHistory.push(
  { content: "What medications should I take this morning?", type: "text", role: "user", language: "english" },
  { content: response1, type: "text", role: "assistant", language: "english" }
);

// Second message (continues the conversation)
const response2 = await chatWithAssistant(
  "<FIREBASE_ID_TOKEN>",
  "What about evening?",
  { history: conversationHistory }
);

console.log("Assistant:", response2);
conversationHistory.push(
  { content: "What about evening?", type: "text", role: "user", language: "english" },
  { content: response2, type: "text", role: "assistant", language: "english" }
);
```

### **Example: Flutter (Dart)**

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class AssistantService {
  final String baseUrl;
  final String firebaseToken;
  List<Map<String, dynamic>> _history = [];

  AssistantService({required this.baseUrl, required this.firebaseToken});

  /// Send a message to the assistant.
  /// Returns the assistant's text response.
  /// The caller is responsible for managing conversation history.
  Future<String> chat({
    required String content,
    String type = 'text',
    String language = 'english',
  }) async {
    final uri = Uri.parse('$baseUrl/api/assistant/chat');

    final res = await http.post(
      uri,
      headers: {
        'Authorization': 'Bearer $firebaseToken',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'query': {'content': content, 'type': type},
        'history': _history,
        'language': language,
      }),
    );

    if (res.statusCode != 200) {
      throw Exception('Assistant API error: ${res.statusCode}');
    }

    final body = jsonDecode(res.body) as Map<String, dynamic>;
    final message = body['data']['message'] as String;

    // The caller should manually append to _history after each exchange
    return message;
  }

  void resetHistory() {
    _history = [];
  }
}
```

### **Example: cURL**

```bash
curl -X POST https://your-server.com/api/assistant/chat \
  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "content": "What medications should I take this morning?",
      "type": "text"
    },
    "history": [],
    "language": "english"
  }'
```

---

## 🆘 Medical Alert (REST API)

The medical alert endpoint sends an **emergency SMS alert** with a Google Maps location link to all emergency contacts configured for the authenticated user's profile.

### **Endpoint**

```
POST /api/medical-alert/send
```

### **Headers**

| Header | Value | Required |
| :----- | :---- | :------- |
| `Authorization` | `Bearer <FIREBASE_ID_TOKEN>` | ✅ Yes |
| `Content-Type` | `application/json` | ✅ Yes |

### **Workflow**

```
┌──────────┐   POST /api/medical-alert/send  ┌──────────────────┐   JSON response    ┌──────────┐
│  Client  │ ─── { latitude, longitude } ───→ │  Medical Alert   │ ─── { result }   → │  Client  │
│          │                                   │  (mNotify SMS)   │                   │          │
└──────────┘                                   └──────────────────┘                   └──────────┘
```

1. **Authenticate**: Attach Firebase JWT token as `Authorization: Bearer <token>`.
2. **Send**: `POST /api/medical-alert/send` with the user's current GPS coordinates.
3. **Fetch contacts**: The server retrieves the user's `emergencyConfig.contacts` from Firestore.
4. **Send SMS**: An SMS is sent via the **mNotify API** to each emergency contact, containing:
   - The user's name
   - A Google Maps link to the user's current location
   - An urgent call to action
5. **Response**: The server returns a per-contact delivery status.

### **Request Body**

```json
{
  "latitude": 5.6037,
  "longitude": -0.1870
}
```

| Field | Type | Constraints | Description |
| :---- | :--- | :---------- | :---------- |
| `latitude` | `number` | `-90` to `90` | GPS latitude coordinate |
| `longitude` | `number` | `-180` to `180` | GPS longitude coordinate |

### **Response Schema**

**Status:** `200 OK`

```json
{
  "status": "success",
  "data": {
    "notified_contacts": [
      {
        "name": "Jane Doe",
        "phoneNumber": "+233501234567",
        "success": true
      },
      {
        "name": "John Smith",
        "phoneNumber": "+233501234568",
        "success": true
      }
    ]
  }
}
```

| Field | Type | Description |
| :---- | :--- | :---------- |
| `status` | `string` | Always `"success"` |
| `data` | `object` | The response payload |
| `data.notified_contacts` | `array` | Array of per-contact delivery results |
| `notified_contacts[].name` | `string` | Contact's name |
| `notified_contacts[].phoneNumber` | `string` | Contact's phone number |
| `notified_contacts[].success` | `boolean` | Whether the SMS was sent successfully |

### **Error Responses**

| Status | Condition |
| :----- | :-------- |
| `400` | Invalid latitude/longitude values |
| `401` | Missing or invalid Firebase JWT token |
| `404` | User not found in Firestore |
| `409` | No emergency contacts configured |

### **Example: JavaScript (Fetch API)**

```javascript
const API_BASE = "https://your-server.com";

async function sendMedicalAlert(firebaseToken, latitude, longitude) {
  const res = await fetch(`${API_BASE}/api/medical-alert/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${firebaseToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ latitude, longitude }),
  });

  if (!res.ok) {
    throw new Error(`Medical alert error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  return json.data;
}

// ── Usage ────────────────────────────────────────────────────
sendMedicalAlert("<FIREBASE_ID_TOKEN>", 5.6037, -0.1870)
  .then((data) => {
    console.log("Contacts notified:", data.notified_contacts.length);
    data.notified_contacts.forEach((c) => {
      console.log(`${c.name} (${c.phoneNumber}): ${c.success ? "✅" : "❌"}`);
    });
  })
  .catch(console.error);
```

### **Example: cURL**

```bash
curl -X POST https://your-server.com/api/medical-alert/send \
  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "latitude": 5.6037,
    "longitude": -0.1870
  }'
```

### **Required Environment Variables**

The medical alert feature requires an additional environment variable beyond the shared ones listed in the next section:

| Variable | Description |
| :------- | :---------- |
| `MNOTIFY_API_KEY` | API key for the mNotify SMS gateway |
| `MNOTIFY_SENDER_ID` | (Optional) SMS sender name (defaults to `"Ntentan"`) |

---

## 🛠️ Environment Variables

Create a `.env` file in the project root:

```env
PORT=8080
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_CLOUD_PROJECT_ID=your_gcp_project_id
VERTEX_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account-key.json
```

---

## 🚀 Running Locally

```bash
# Install dependencies
npm install

# Start the server
npm run dev
```

The server will start on `http://localhost:8080`.

### Testing the MedScanner

Open `playground/test.html` in a browser (served via a local HTTP server) to test the medication scanner with a live camera feed and raw WebSocket connection.

---

## 📁 Project Structure

```
src/
├── index.ts                            # Express + Socket.IO server setup
├── features/
│   ├── medication-scanner/
│   │   └── medscanner.service.ts       # MedScanner WebSocket handler, Gemini inference, vector search
│   ├── medical-alert/
│   │   ├── medical-alert.routes.ts      # Express routes for POST /api/medical-alert/send
│   │   ├── medical-alert.schema.ts      # Zod validation schemas for the alert endpoint
│   │   └── medical-alert.service.ts     # Emergency SMS dispatch via mNotify API
│   └── assistant/
│       ├── assistant.routes.ts          # Express routes for POST /api/assistant/chat
│       ├── assistant.service.ts         # Assistant request handler (HTTP)
│       ├── assistant.schema.ts          # Zod validation schemas for the chat endpoint
│       ├── assistant.ts                # MedicalAssistant class (Gemini chat)
│       ├── assistant.tools.ts          # Gemini tool definitions
│       ├── prescription.tools.ts       # Prescription query tools (vector search, CRUD)
│       ├── drugInfo.tools.ts           # Drug information lookup (OpenFDA + LLM)
│       └── voice.service.ts            # Twi audio transcription & translation
├── middlewares/
│   ├── auth.middleware.ts              # Firebase JWT authentication middleware (HTTP)
│   ├── socket-auth.middleware.ts       # Firebase JWT authentication middleware (WebSocket)
│   ├── error-handler.middleware.ts     # Global error handling
│   └── validator.middleware.ts         # Zod validation middleware
├── types/
│   ├── medscanner.ts                   # MedScanner response types, Zod schemas
│   └── assistant.ts                    # Assistant message types, Prescription, DrugInfo
├── lib/
│   ├── firebase.ts                     # Firebase admin initialisation
│   ├── logger.ts                       # Structured logger
│   └── errors.ts                       # Custom error classes
└── prompts/
    └── index.ts                        # System prompts / few-shot examples