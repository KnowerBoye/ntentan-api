import { GoogleGenAI, Content, FunctionCall } from "@google/genai";
import { tools } from "@features/assistant/assistant.tools";
import { queryPrescriptions, savePrescription } from "@features/assistant/prescription.tools";
import { searchDrugInfo } from "@features/assistant/drugInfo.tools";
import {
  ChatMessage,
  AssistantResponse,
  QueryPrescriptionsInput,
  SavePrescriptionInput,
  SearchDrugInfoInput,
  UserMessage as UserMessage,
} from "@/types/assistant";


function buildSystemPrompt(): string {
  return `You are a professional and empathetic AI medical assistant.

## Your Role
You help users manage their personal prescriptions and provide factual drug education.

## Time Slots
Medications have time slots (morning, afternoon, evening) rather than specific dates.
- Morning (06:00-12:00)
- Afternoon (12:00-17:00)
- Evening (17:00-22:00)
Use these windows to determine what the user should take next.

## Prescription Queries (Personal)
- ALWAYS call query_prescriptions before answering any personal prescription question.
- Never guess or fabricate prescription data.
- Use the contextNote returned by the tool to anchor your response.
- If the user asks about a specific medication by name, use intent="medication_info" with the drugName.
- If the user asks what to take next, use intent="next".
- If the user asks to see all their medications, use intent="all_active".

## General Drug Enquiries
- Call search_drug_info first for factual FDA data.
- If needsLLMSupplement is true, fill in gaps with your medical knowledge.
- ALWAYS end general drug responses with:
  "⚕️ Please consult your doctor or pharmacist before making any changes to your medication."
- NEVER recommend a drug, suggest a dosage, or imply a drug is appropriate for the user.

## Response Formatting
- Use bullet points for medication lists.
- Show time-of-day slots clearly: Morning (06:00-12:00), Afternoon (12:00–17:00), Evening (17:00–22:00).
- Show quantity and dosage together: e.g. "2 x 500mg tablets".
- Include special instructions if present.
- Keep responses warm, concise, and clear.

## Saving Prescriptions
- You can save a new prescription to the user's records using the save_prescription tool.
- Required fields: name, timeSlots, dosage, unitsPerDose, frequency
- Optional fields: strength, instruction
- If the user asks to save a prescription but some required fields are missing, ask follow-up questions ONE AT A TIME until you have all required information before calling the tool.
- After saving, confirm the details with the user and show them what was saved.
- If a medication with the same name already exists, ask the user if they want to update the existing one instead of creating a duplicate.

## Hard Safety Rules
1. You are NOT a doctor. Never diagnose, prescribe, or recommend treatments.
2. Never suggest stopping or changing a prescribed dosage.
3. Medical emergencies → immediately direct the user to call emergency services.
4. Drug abuse / overdose / self-harm → provide crisis resources only.`;
}


async function dispatchTool(
  call: FunctionCall,
  userId: string
): Promise<{ result: unknown; isSearch: boolean }> {
  const args = (call.args ?? {}) as Record<string, unknown>;

  if (call.name === "query_prescriptions") {
    const input: QueryPrescriptionsInput = {
      userId,
      intent: args.intent as QueryPrescriptionsInput["intent"],
      drugName: args.drugName as string | undefined,
    };
    return { result: await queryPrescriptions(input), isSearch: false };
  }

  if (call.name === "search_drug_info") {
    return {
      //@ts-ignore
      result: await searchDrugInfo(args as SearchDrugInfoInput),
      isSearch: true,
    };
  }

  if (call.name === "save_prescription") {
    const input: SavePrescriptionInput = {
      userId,
      name: args.name as string,
      timeSlots: args.timeSlots as string[],
      dosage: args.dosage as string,
      unitsPerDose: args.unitsPerDose as number,
      frequency: args.frequency as number,
      strength: args.strength as string | undefined,
      instruction: args.instruction as string | undefined,
    };
    return { result: await savePrescription(input), isSearch: false };
  }

  return {
    result: { success: false, error: `Unknown tool: ${call.name}` },
    isSearch: false,
  };
}


export class MedicalAssistant {
  private ai: GoogleGenAI;
  private readonly model = "models/gemini-2.5-flash";

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  /**
   * Send a user message and get a response.
   *
   * @param userMessage  Raw user text
   * @param userId       Authenticated user ID (server-injected, never from client)
   * @param history      Prior conversation turns
   */
  async chat(
    userMessage: UserMessage,
    userId: string,
    history: ChatMessage[] = []
  ): Promise<AssistantResponse> {
    const toolsUsed: string[] = [];
    const sources: string[] = [];

  
    const contents: Content[] = [
    ...history.map((m): Content => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{
        text: m.type === "audio" ? "[User sent an audio message]" : m.content
      }]
    })),
    {
      role: "user",
      parts:
        userMessage.type === "audio"
          ? [
              {
                inlineData: {
                  mimeType: "audio/wav", 
                  data: userMessage.content, 
                },
              },
            ]
          : [
              {
                text: userMessage.content,
              },
            ],
    },
  ];

 
    while (true) {
      const response = await this.ai.models.generateContent({
        model: this.model,
        config: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          systemInstruction: buildSystemPrompt(),
          tools,
        },
        contents,
      });

      const candidate = response.candidates?.[0];
      if (!candidate?.content?.parts) {
        return {
          message: "I'm sorry, I couldn't generate a response. Please try again.",
          toolsUsed,
        };
      }

      // Add model turn to contents for next iteration
      contents.push({
        role: "model",
        parts: candidate.content.parts,
      });

      // Collect any function calls in this response
      const calls = candidate.content.parts
        .filter((p) => !!p.functionCall)
        .map((p) => p.functionCall!);

      if (!calls.length) {
        // No more tool calls – extract final text
        const finalText = candidate.content.parts
          .filter((p) => !!p.text)
          .map((p) => p.text)
          .join("");

        return {
          message: finalText || "I'm sorry, I couldn't generate a response.",
          toolsUsed,
          sources: sources.length ? sources : undefined,
        };
      }

      // Execute all tool calls in parallel and collect results
      const toolResultParts = await Promise.all(
        calls.map(async (call) => {
          toolsUsed.push(call.name!);
          const { result, isSearch } = await dispatchTool(call, userId);
          if (isSearch) sources.push("OpenFDA Drug Label Database");

          return {
            functionResponse: {
              name: call.name!,
              response: { result },
            },
          };
        })
      );

      // Feed tool results back to Gemini
      contents.push({
        role: "user",
        parts: toolResultParts,
      });
    }
  }
}