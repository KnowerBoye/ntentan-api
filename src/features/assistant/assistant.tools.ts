
import { Tool , Type} from "@google/genai";

export const tools: Tool[] = [
  {
    functionDeclarations: [
      // ── 1. Unified prescription query ──────────
      {
        name: "query_prescriptions",
        description: `Query the user's prescription records. Use this for ANY question about the user's personal medications.

Resolve all relative date references to YYYY-MM-DD using the currentDate provided in the system prompt before calling this tool.

Intent mapping:
- "today"      → what medications do I take today? (use targetDate = currentDate)
- "on_date"    → what did I take on [date]? (use targetDate = resolved date)
- "next"       → when is my next dose of X? (use drugName)
- "last"       → when was my last dose of X? (use drugName)
- "check"      → did I take X yesterday/on [date]? (use drugName + targetDate)
- "all_active" → list all my prescriptions

Examples:
  "What do I take today?"              → intent="today", targetDate=currentDate
  "What did I take yesterday?"         → intent="on_date", targetDate=yesterday
  "When is my next paracetamol?"       → intent="next", drugName="paracetamol"
  "When was my last paracetamol?"      → intent="last", drugName="paracetamol"
  "Did I take paracetamol yesterday?"  → intent="check", drugName="paracetamol", targetDate=yesterday
  "Do I take paracetamol today?"       → intent="check", drugName="paracetamol", targetDate=currentDate
  "Show all my prescriptions"          → intent="all_active"`,

        parameters: {
          type: Type.OBJECT,
          properties: {
            intent: {
              type: Type.STRING,
              enum: ["today", "on_date", "next", "last", "check", "all_active"],
              description: "The query intent (see description above)",
            },
            targetDate: {
              type: Type.STRING,
              description:
                "Resolved date in YYYY-MM-DD format. Required for: today, on_date, check. Optional for others.",
            },
            drugName: {
              type: Type.STRING,
              description:
                "Drug name to filter by. Required for: next, last, check. Optional for: today, on_date.",
            },
          },
          required: ["intent"],
        },
      },


      {
        name: "search_drug_info",
        description: `Search for general information about any drug from the OpenFDA medical database.

Use this ONLY for general drug knowledge questions NOT about the user's personal prescriptions.
Examples: "What is paracetamol used for?", "What are the side effects of amoxicillin?", "What drug class is metformin?"

NEVER use this tool to make dosage recommendations or suggest drugs to the user.`,

        parameters: {
          type: Type.OBJECT,
          properties: {
            drugName: {
              type: Type.STRING,
              description: "The drug name to look up (brand or generic)",
            },
            query: {
              type: Type.STRING,
              description:
                "Optional: specific aspect the user is asking about (e.g. 'side effects', 'uses', 'interactions')",
            },
          },
          required: ["drugName"],
        },
      },
    ],
  },
];