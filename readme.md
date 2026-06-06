# Ntentan API

WebSocket API server for medication scanning and medical assistant services, powered by Google Gemini AI.

---

##  Authentication

All WebSocket namespaces require **Firebase JWT authentication**. The token is verified on every connection.

### Auth Methods

| Method | Location | Example |
| :----- | :------- | :------ |
| Handshake auth | `socket.handshake.auth.token` | `{ auth: { token: "<FIREBASE_ID_TOKEN>" } }` |
| Query parameter | URL `?token=` | `io("SERVER/med-scanner?token=<FIREBASE_ID_TOKEN>")` |

### Failure

If the token is missing or invalid, the connection is rejected with an `UnauthorizedError` and the socket will not connect.

---

##  Medication Scanner (WebSocket)

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
      console.log(` ${data.guidance_text}`);
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
        print('${response['guidance_text']}');
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

## 🤖 Medical Assistant (WebSocket)

The `assistant` endpoint provides a persistent session for medical inquiries. It maintains a conversation history in memory and processes both text and audio inputs, with specialised support for **Twi** language translation and transcription.

### **Endpoint**
```
WS /assistant
```

### **Workflow**
1. **Connection**: A unique session history is initialised for the user.
2. **Multimodal Processing**:
   * **English Text/Audio**: Passed to the Medical Assistant.
   * **Twi Text**: Translated to English before processing.
   * **Twi Audio**: Transcribed and translated to English text via a voice service.
3. **Persistence**: Every exchange is pushed to a `history` array to maintain context for the AI.

---

### **Request Payload**
The client emits a `message` event. Audio content must be sent as a **Base64 encoded string**.

**Event Name:** `message`

| Field | Type | Description |
| :---- | :--- | :---------- |
| `type` | `string` | `"text"` or `"audio"` |
| `content` | `string` | The message text or **Base64 encoded** audio string |
| `language` | `string` | `"english"` or `"twi"` |

---

### **Response Schema**
The server emits a `response` event containing the assistant's clinical feedback.

**Event Name:** `response`

| Field | Type | Description |
| :---- | :--- | :---------- |
| `role` | `string` | Always `"assistant"` |
| `content` | `string` | The plain text response from the AI |
| `type` | `string` | `"text"` |
| `language` | `string` | `"english"` |

---

### **Example: JavaScript (Socket.IO Client)**

```javascript
import { io } from "socket.io-client";

const socket = io("https://your-server.com/assistant", {
  auth: { token: "<FIREBASE_ID_TOKEN>" },
  transports: ["websocket"],
});

// ── Send text message ────────────────────────────────────────
function sendMessage(text, language = "english") {
  socket.emit("message", {
    type: "text",
    language: language,
    content: text,
  });
}

// ── Send Twi audio as Base64 ─────────────────────────────────
function sendTwiAudio(base64String) {
  socket.emit("message", {
    type: "audio",
    language: "twi",
    content: base64String,
  });
}

// ── Receive AI response ──────────────────────────────────────
socket.on("response", (data) => {
  // data = { role: "assistant", content: "...", type: "text", language: "english" }
  console.log("Assistant:", data.content);
});

socket.on("error", (msg) => console.error("Server Error:", msg));
```

### **Example: Flutter (Dart)**

```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'dart:convert';

class AssistantService {
  late IO.Socket _socket;

  void connect(String serverUrl, String firebaseToken) {
    _socket = IO.io(
      '$serverUrl/assistant',
      IO.OptionBuilder()
        .setAuth({'token': firebaseToken})
        .setTransports(['websocket'])
        .build(),
    );
  }

  /// Send a text message (English or Twi)
  void sendText(String text, {String language = 'english'}) {
    _socket.emit('message', {
      'type': 'text',
      'language': language,
      'content': text,
    });
  }

  /// Send audio bytes (must be Base64 encoded)
  void sendAudio(List<int> bytes, {String language = 'english'}) {
    String base64Audio = base64Encode(bytes);
    _socket.emit('message', {
      'type': 'audio',
      'language': language,
      'content': base64Audio,
    });
  }

  /// Listen for assistant responses
  void onResponse(void Function(Map<String, dynamic>) callback) {
    _socket.on('response', (data) {
      callback(data as Map<String, dynamic>);
    });
  }

  void disconnect() {
    _socket.disconnect();
  }
}
```

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
│   └── assistant/
│       ├── assistant.service.ts        # Assistant WebSocket handler
│       ├── assistant.ts                # MedicalAssistant class (Gemini chat)
│       ├── voice.service.ts            # Twi audio transcription & translation
│       └── ...
├── middlewares/
│   ├── socket-auth.middleware.ts       # Firebase JWT authentication middleware
│   └── error-handler.middleware.ts     # Global error handling
├── types/
│   ├── medscanner.ts                   # MedScanner response types, Zod schemas
│   └── assistant.ts                    # Assistant message types
└── lib/
    ├── firebase.ts                     # Firebase admin initialisation
    ├── logger.ts                       # Structured logger
    └── errors.ts                       # Custom error classes