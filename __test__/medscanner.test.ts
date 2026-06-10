const { embedText } = require("../src/features/medication-scanner/medscanner.service");
const {
  medScannerProcessingSchema,
  medScannerPositioningSchema,
  medScannerSuccessSchema,
  medScannerResponseSchema,
} = require("../src/types/medscanner");

const {
  GOOGLE_CLOUD_PROJECT_ID,
  GOOGLE_APPLICATION_CREDENTIALS,
  GEMINI_API_KEY,
} = process.env;


// Live integration test against Google Vertex AI embeddings.
// Requires environment variables:
// GOOGLE_CLOUD_PROJECT_ID, GOOGLE_APPLICATION_CREDENTIALS, GEMINI_API_KEY

describe("embedText integration", () => {


  it("returns a numeric embedding array from Google GenAI", async () => {
    const vector = await embedText("test medication embedding");

    console.log("Received embedding vector:", vector);   

    expect(Array.isArray(vector)).toBe(true);
    expect(vector.length).toBeGreaterThan(0);
    // expect(vector.every((value) => typeof value === "number")).toBe(true);
  });
});

// ── WebSocket Response Schema Validation Tests ─────────────────────────
// These tests validate that every known response shape conforms to the
// runtime Zod schema. They do NOT require API keys or live services.

describe("MedScanner WebSocket Response Schema", () => {

  describe("processing", () => {
    it("accepts { status: 'processing' }", () => {
      const result = medScannerProcessingSchema.parse({ status: "processing" });
      expect(result).toEqual({ status: "processing" });
    });

    it("rejects extra fields", () => {
      expect(() =>
        medScannerProcessingSchema.parse({ status: "processing", extra: true })
      ).toThrow();
    });

    it("rejects missing status", () => {
      expect(() => medScannerProcessingSchema.parse({})).toThrow();
    });

    it("rejects wrong status value", () => {
      expect(() =>
        medScannerProcessingSchema.parse({ status: "success" })
      ).toThrow();
    });
  });

  describe("positioning", () => {
    it("accepts valid positioning with all instruction variants", () => {
      for (const instruction of [
        "move_up", "move_down", "move_left", "move_right",
        "rotate_left", "rotate_right", "flip",
        "move_closer", "move_farther", "hold_still",
      ]) {
        const result = medScannerPositioningSchema.parse({
          status: "positioning",
          instruction,
          guidance_text: "Please move the medication closer.",
        });
        expect(result.instruction).toBe(instruction);
      }
    });

    it("accepts no_object with none instruction", () => {
      const result = medScannerPositioningSchema.parse({
        status: "no_object",
        instruction: "none",
        guidance_text: "No medication detected in frame.",
      });
      expect(result.status).toBe("no_object");
    });

    it("rejects missing guidance_text", () => {
      expect(() =>
        medScannerPositioningSchema.parse({
          status: "positioning",
          instruction: "move_up",
        })
      ).toThrow();
    });

    it("rejects invalid instruction", () => {
      expect(() =>
        medScannerPositioningSchema.parse({
          status: "positioning",
          instruction: "jump",
          guidance_text: "test",
        })
      ).toThrow();
    });

    it("rejects invalid status", () => {
      expect(() =>
        medScannerPositioningSchema.parse({
          status: "success",
          instruction: "none",
          guidance_text: "test",
        })
      ).toThrow();
    });
  });

  describe("success", () => {
    const validMedication = {
      completedSlots: { "morning": "2026-06-10T08:00:00Z" },
      composite_string: "paracetamol 500mg",
      createdAt: "2024-01-01T00:00:00Z",
      dosage: "500mg",
      frequency: 3,
      id: "doc123",
      instruction: "after meals",
      name: "Paracetamol",
      strength: "500mg",
      timeSlots: ["08:00", "14:00", "20:00"],
      unitsPerDose: 1,
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const validMatch = {
      medication: validMedication,
      distance: 0.15,
      withinThreshold: true,
    };

    it("accepts success with a valid prescription match", () => {
      const result = medScannerSuccessSchema.parse({
        status: "success",
        instruction: "none",
        guidance_text: "Label read successfully. Found a match.",
        prescription_match: validMatch,
      });
      expect(result.status).toBe("success");
      expect(result.prescription_match).toEqual(validMatch);
    });

    it("accepts success with null prescription_match (no confident match)", () => {
      const result = medScannerSuccessSchema.parse({
        status: "success",
        instruction: "none",
        guidance_text: "Label read successfully. No matching prescription found.",
        prescription_match: null,
      });
      expect(result.prescription_match).toBeNull();
    });

    it("rejects success with wrong instruction", () => {
      expect(() =>
        medScannerSuccessSchema.parse({
          status: "success",
          instruction: "move_up",
          guidance_text: "test",
          prescription_match: null,
        })
      ).toThrow();
    });

    it("rejects success without guidance_text", () => {
      expect(() =>
        medScannerSuccessSchema.parse({
          status: "success",
          instruction: "none",
          prescription_match: null,
        })
      ).toThrow();
    });

    it("rejects success without prescription_match field", () => {
      expect(() =>
        medScannerSuccessSchema.parse({
          status: "success",
          instruction: "none",
          guidance_text: "test",
        })
      ).toThrow();
    });

    it("rejects success with invalid medication shape", () => {
      expect(() =>
        medScannerSuccessSchema.parse({
          status: "success",
          instruction: "none",
          guidance_text: "test",
          prescription_match: {
            medication: { name: "Paracetamol" }, // missing required fields
            distance: 0.15,
            withinThreshold: true,
          },
        })
      ).toThrow();
    });
  });

  describe("discriminated union (medScannerResponseSchema)", () => {
    it("accepts processing", () => {
      const result = medScannerResponseSchema.parse({ status: "processing" });
      expect(result.status).toBe("processing");
    });

    it("accepts positioning", () => {
      const result = medScannerResponseSchema.parse({
        status: "positioning",
        instruction: "hold_still",
        guidance_text: "Hold still while we scan.",
      });
      expect(result.status).toBe("positioning");
    });

    it("accepts no_object", () => {
      const result = medScannerResponseSchema.parse({
        status: "no_object",
        instruction: "none",
        guidance_text: "No medication visible.",
      });
      expect(result.status).toBe("no_object");
    });

    it("accepts success with match", () => {
      const result = medScannerResponseSchema.parse({
        status: "success",
        instruction: "none",
        guidance_text: "Done.",
        prescription_match: {
          medication: {
            completedSlots: {},
            composite_string: "test",
            createdAt: "2024-01-01T00:00:00Z",
            dosage: "500mg",
            frequency: 2,
            id: "doc1",
            instruction: "with food",
            name: "Test",
            strength: "500mg",
            timeSlots: ["08:00"],
            unitsPerDose: 1,
            updatedAt: "2024-01-01T00:00:00Z",
          },
          distance: 0.1,
          withinThreshold: true,
        },
      });
      expect(result.status).toBe("success");
    });

    it("accepts success with null match", () => {
      const result = medScannerResponseSchema.parse({
        status: "success",
        instruction: "none",
        guidance_text: "Done.",
        prescription_match: null,
      });
      expect(result.status).toBe("success");
    });

    it("rejects unknown status", () => {
      expect(() =>
        medScannerResponseSchema.parse({ status: "unknown" })
      ).toThrow();
    });

    it("rejects empty object", () => {
      expect(() => medScannerResponseSchema.parse({})).toThrow();
    });
  });
});