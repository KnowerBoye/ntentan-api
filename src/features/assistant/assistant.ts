
import { GoogleGenAI, Content, FunctionCall } from "@google/genai";
import { format } from "date-fns";
import { tools } from "@features/assistant/assistant.tools";
import { queryPrescriptions } from "@features/assistant/prescription.tools";
import { searchDrugInfo } from "@features/assistant/drugInfo.tools";
import {
  ChatMessage,
  AssistantResponse,
  QueryPrescriptionsInput,
  SearchDrugInfoInput,
} from "@features/assistant/types";


function buildSystemPrompt(): string {
  const currentDate = format(new Date(), "yyyy-MM-dd");
  const currentTime = format(new Date(), "HH:mm");
  const dayOfWeek  = format(new Date(), "EEEE");

  return `You are a professional and empathetic AI medical assistant.

## Context
currentDate: ${currentDate}  (${dayOfWeek})
currentTime: ${currentTime}
Use these values when resolving relative dates like "today", "yesterday", "tomorrow".

## Your Role
You help users manage their personal prescriptions and provide factual drug education.

## Prescription Queries (Personal)
- ALWAYS call query_prescriptions before answering any personal prescription question.
- Never guess or fabricate prescription data.
- Resolve relative dates to YYYY-MM-DD before calling the tool:
    "today"     → ${currentDate}
    "yesterday" → ${format(new Date(Date.now() - 86400000), "yyyy-MM-dd")}
    "tomorrow"  → ${format(new Date(Date.now() + 86400000), "yyyy-MM-dd")}
- Use the contextNote returned by the tool to anchor your response.

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
      targetDate: args.targetDate as string | undefined,
      drugName: args.drugName as string | undefined,
    };
    return { result: await queryPrescriptions(input), isSearch: false };
  }

  if (call.name === "search_drug_info") {
    return {
      result: await searchDrugInfo(args as SearchDrugInfoInput),
      isSearch: true,
    };
  }

  return {
    result: { success: false, error: `Unknown tool: ${call.name}` },
    isSearch: false,
  };
}


export class MedicalAssistant {
  private ai: GoogleGenAI;
  private readonly model = "gemini-2.0-flash";

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
    userMessage: string,
    userId: string,
    history: ChatMessage[] = []
  ): Promise<AssistantResponse> {
    const toolsUsed: string[] = [];
    const sources: string[] = [];

  
    const contents: Content[] = [
      ...history.map((m): Content => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      {
        role: "user",
        parts: [{ text: userMessage }],
      },
    ];

 
    while (true) {
      const response = await this.ai.models.generateContent({
        model: this.model,
        systemInstruction: buildSystemPrompt(),
        tools,
        config: {
          temperature: 0.2,
          maxOutputTokens: 1024,
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