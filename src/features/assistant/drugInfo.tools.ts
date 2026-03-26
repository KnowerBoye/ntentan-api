
import axios from "axios";
import { DrugInfo, ToolResult, SearchDrugInfoInput } from "@/types/assistant";

const OPENFDA_BASE = "https://api.fda.gov/drug";

interface OpenFDALabelResult {
  openfda?: {
    brand_name?: string[];
    generic_name?: string[];
    pharm_class_epc?: string[];
  };
  description?: string[];
  indications_and_usage?: string[];
  warnings?: string[];
  drug_interactions?: string[];
  adverse_reactions?: string[];
}

interface OpenFDAResponse {
  results?: OpenFDALabelResult[];
}

async function queryOpenFDA(drugName: string): Promise<Partial<DrugInfo> | null> {
  try {
    const apiKey = process.env.OPENFDA_API_KEY;
    const keyParam = apiKey ? `&api_key=${apiKey}` : "";

    for (const field of ["openfda.brand_name", "openfda.generic_name"]) {
      const q = `${field}:"${drugName}"`;
      const url = `${OPENFDA_BASE}/label.json?search=${encodeURIComponent(q)}&limit=1${keyParam}`;
      const res = await axios.get<OpenFDAResponse>(url, { timeout: 8000 });

      if (!res.data.results?.length) continue;
      const r = res.data.results[0];

      return {
        name: drugName,
        genericName: r.openfda?.generic_name?.[0],
        brandNames: r.openfda?.brand_name,
        drugClass: r.openfda?.pharm_class_epc?.[0],
        description: r.description?.[0]?.substring(0, 600),
        commonUses: r.indications_and_usage?.map((s) => s.substring(0, 300)),
        warnings: r.warnings?.map((s) => s.substring(0, 300)),
        commonSideEffects: r.adverse_reactions?.map((s) => s.substring(0, 300)),
        interactions: r.drug_interactions?.map((s) => s.substring(0, 300)),
        source: "openfda",
      };
    }

    return null;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    console.error("[OpenFDA] query failed:", err);
    return null;
  }
}

export async function searchDrugInfo(
  input: SearchDrugInfoInput
): Promise<ToolResult<DrugInfo>> {
  try {
    const fdaData = await queryOpenFDA(input.drugName);

    if (fdaData) {
      const hasEnoughData =
        !!fdaData.description &&
        !!fdaData.commonUses?.length &&
        !!fdaData.commonSideEffects?.length;

      return {
        success: true,
        data: {
          name: input.drugName,
          source: "openfda",
          needsLLMSupplement: !hasEnoughData,
          ...fdaData,
        } as DrugInfo,
      };
    }

    // Not in FDA DB – signal LLM to use its own knowledge
    return {
      success: true,
      data: {
        name: input.drugName,
        source: "llm",
        needsLLMSupplement: true,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}