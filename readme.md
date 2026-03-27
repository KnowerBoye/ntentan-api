

## Medication Scanner (WebSocket)

The `med-scanner` endpoint allows a client to stream camera frames to the server. The server buffers these frames and uses AI to provide real-time positioning feedback until the medication label is successfully read.

### **Endpoint**
`WS /med-scanner`

### **Workflow**
1.  **Stream**: The client emits binary chunks of image data (JPEG).
2.  **Buffer**: The server accumulates up to 5 frames or waits 800ms before processing.
3.  **Inference**: The Gemini model analyzes the frames to determine if the label is visible, readable, or needs repositioning.
4.  **Feedback**: The server emits a JSON response with specific movement instructions (e.g., "move_closer", "rotate_left").

---

### **Request Payload**
The client should emit a `frame` event containing a binary buffer of the image.

**Event Name:** `frame`
**Data Type:** `Buffer` (JPEG format recommended)

---

### **Response Schema**
The server emits a `response` event with a JSON string.

| Field | Type | Description |
| :--- | :--- | :--- |
| `status` | `string` | `no_object`, `positioning`, `success`, or `processing` |
| `instruction` | `string` | Movement command: `move_up`, `move_down`, `move_closer`, `flip`, etc. |
| `guidance_text` | `string` | A user-friendly sentence explaining what to do. |
| `medication` | `object` | **Only present on `success`**. Contains `drug_name` and `raw_label_text`. |

#### **Example Success Response**
```json
{
  "status": "success",
  "instruction": "none",
  "guidance_text": "I've successfully read the label.",
  "medication": {
    "drug_name": "Ibuprofen 200mg",
    "raw_label_text": ["Advil", "Ibuprofen Tablets 200mg", "Pain Reliever", "50 Coated Capsules"]
  }
}
```

---

### **Implementation Examples**

#### **JavaScript (Socket.io-client)**
```javascript
import { io } from "socket.io-client";

const socket = io("YOUR_SERVER_URL");

// Sending a frame (e.g., from a Canvas or Video element)
function sendFrame(canvasElement) {
  canvasElement.toBlob((blob) => {
    blob.arrayBuffer().then((buf) => {
      socket.emit("frame", { buf });
    });
  }, "image/jpeg", 0.7);
}

// Handling instructions
socket.on("response", (data) => {
  const res = JSON.parse(data);
  console.log(`${res.status}: ${res.guidance_text}`);
  
  if (res.status === "success") {
    console.log("Medication Found:", res.medication.drug_name);
  }
});
```

#### **Dart (socket_io_client)**
```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;

void setupScanner() {
  IO.Socket socket = IO.io('YOUR_SERVER_URL', 
    IO.OptionBuilder().setTransports(['websocket']).build()
  );

  // Sending a frame
  void sendFrame(List<int> imageBytes) {
    socket.emit('frame', {'buf': imageBytes});
  }



  // Listening for guidance
  socket.on('response', (data) {
    // Data is a JSON string from the server
    print('Server says: $data');
  });
}
```




This section covers the `assistant` WebSocket service, which manages multi-modal medical consultations. It features specialized handling for **Twi** translation and transcription to ensure accessible healthcare guidance.

---

## 🤖 Medical Assistant (WebSocket)

The `assistant` endpoint provides a persistent session for medical inquiries. It maintains a conversation history in memory and processes both text and audio inputs.

### **Endpoint**
`WS /assistant`

### **Workflow**
1.  **Connection**: A unique session history is initialized for the user.
2.  **Multimodal Processing**: 
    * **English Text/Audio**: Passed to the Medical Assistant.
    * **Twi Text**: Translated to English before processing.
    * **Twi Audio**: Transcribed and translated to English text via a voice service.
3.  **Persistence**: Every exchange is pushed to a `history` array to maintain context for the AI.

---

### **Request Payload**
The client emits a `message` event. **Note:** Audio content must be sent as a **Base64 encoded string**.

**Event Name:** `message`

| Field | Type | Description |
| :--- | :--- | :--- |
| `type` | `string` | `"text"` or `"audio"` |
| `content` | `string` | The message text or **Base64 encoded** audio string |
| `language` | `string` | `"english"` or `"twi"` |

---

### **Response Schema**
The server emits a `response` event containing the assistant's clinical feedback.

| Field | Type | Description |
| :--- | :--- | :--- |
| `role` | `string` | Always `"assistant"` |
| `content` | `string` | The plain text response from the AI |
| `type` | `string` | `"text"` |
| `language` | `string` | `"english"` |

---

### **Corrected Implementation Examples**

#### **JavaScript (Socket.io-client)**
```javascript
import { io } from "socket.io-client";

const socket = io("YOUR_SERVER_URL/assistant");

// Example: Sending Twi Audio as Base64
function sendTwiAudio(base64String) {
  socket.emit("message", {
    type: "audio",
    language: "twi",
    content: base64String 
  });
}

// Receiving the AI response
socket.on("response", (data) => {
  // data = { role: "assistant", content: "...", ... }
  console.log("Assistant:", data.content);
});

socket.on("error", (msg) => console.error("Server Error:", msg));
```

#### **Dart (socket_io_client)**
```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'dart:convert';

void setupAssistant() {
  IO.Socket socket = IO.io('YOUR_SERVER_URL/assistant', 
    IO.OptionBuilder().setTransports(['websocket']).build()
  );

  // Sending Audio (must be Base64 encoded)
  void sendAudio(List<int> bytes) {
    String base64Audio = base64Encode(bytes);
    socket.emit('message', {
      'type': 'audio',
      'content': base64Audio,
      'language': 'english'
    });
  }

  // Receiving response
  socket.on('response', (data) {
    // Data is the JSON object containing the assistant's reply
    print('Assistant says: ${data['content']}');
  });

  socket.on('error', (data) => print('Error: $data'));
}
```

---

