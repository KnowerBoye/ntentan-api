

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




##  Medical Assistant (WebSocket)

The `assistant` endpoint provides a persistent session for medical inquiries. It maintains a short-term conversation history and can process both standard English text/audio and Twi language inputs by translating them before clinical analysis.

### **Endpoint**
`WS /assistant`

### **Workflow**
1.  **Connection**: Upon connecting, a unique session history is initialized in memory.
2.  **Processing**: 
    * **Text/English**: Passed directly to the Medical Assistant.
    * **Text/Twi**: Translated to English text first.
    * **Audio/Twi**: Transcribed and translated to English text via specialized voice services.
    * **Audio/English**: Sent as raw audio data for multimodal processing.
3.  **Response**: The Gemini-powered `MedicalAssistant` generates a response which is then added to the session history.

---

### **Request Payload**
The client emits a `message` event with a `UserMessage` object.

**Event Name:** `message`

| Field | Type | Description |
| :--- | :--- | :--- |
| `type` | `string` | `"text"` or `"audio"` |
| `content` | `string \| Buffer` | The message string or raw audio buffer |
| `language` | `string` | `"english"` or `"twi"` |

---

### **Response Schema**
The server currently processes the message and updates the internal history. (Note: Ensure your client listens for the `assistant_response` event, usually emitted by the `assistant.chat` logic).

#### **Error Handling**
If a server-side error occurs, the server emits:
**Event Name:** `error`
**Data:** `"An unexpected server error occured"`
*Note: On error, the socket is disconnected and the session history is cleared.*

---

### **Implementation Examples**

#### **JavaScript (Socket.io-client)**
```javascript
import { io } from "socket.io-client";

const socket = io("YOUR_SERVER_URL/assistant");

// Sending a Twi Voice Note
function sendTwiAudio(audioBuffer) {
  socket.emit("message", {
    type: "audio",
    language: "twi",
    content: audioBuffer // Buffer from recorder
  });
}

// Sending English Text
function sendEnglishText(text) {
  socket.emit("message", {
    type: "text",
    language: "english",
    content: text
  });
}

socket.on("error", (msg) => console.error(msg));
```

#### **Dart (socket_io_client)**
```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;

void setupAssistant() {
  IO.Socket socket = IO.io('YOUR_SERVER_URL/assistant', 
    IO.OptionBuilder().setTransports(['websocket']).build()
  );

  // Sending English Text
  void sendMessage(String text) {
    socket.emit('message', {
      'type': 'text',
      'content': text,
      'language': 'english'
    });
  }

    //recieve response
    socket.on('response', (data) {
    // Data is a JSON string from the server
    print('Server says: $data');
  });

  // Listening for errors
  socket.on('error', (data) => print('Error: $data'));
}
```

---
