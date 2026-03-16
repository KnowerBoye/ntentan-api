const ws = new WebSocket("ws://localhost:8080");
let frameInterval = null;

ws.onopen = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });

  // Draw stream to canvas so we can grab JPEG frames
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  video.srcObject = stream;
  video.play();

  video.onloadedmetadata = () => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Send a JPEG frame every 500ms
    frameInterval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;

      ctx.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) => blob?.arrayBuffer().then((buf) => ws.send(buf)),
        "image/jpeg",
        0.8 // quality
      );
    }, 500);
  };
};

// Handle responses from Gemini
ws.onmessage = (event) => {
  try {
    const response = JSON.parse(event.data);
    console.log("Scan response:", response);

    const { status, instruction, guidance_text, medication } = response;

    // Update your UI here
    document.getElementById("guidance").textContent = guidance_text;
    document.getElementById("status").textContent = status;

    if (status === "success" && medication) {
      clearInterval(frameInterval); // stop scanning
      ws.close();
      displayResult(medication);
    }

  } catch (e) {
    console.error("Failed to parse response:", e);
  }
};

function displayResult(med) {
  console.log("✅ Medication extracted:", med);
  // Populate your result UI
  document.getElementById("drug-name").textContent = med.drug_name;
  document.getElementById("dosage").textContent = med.dosage;
  document.getElementById("instructions").textContent = med.instructions;
  // etc.
}

ws.onclose = () => clearInterval(frameInterval);
ws.onerror = (err) => console.error("WS error:", err);
```

---

### `.env`
```
GEMINI_API_KEY=your-key-here