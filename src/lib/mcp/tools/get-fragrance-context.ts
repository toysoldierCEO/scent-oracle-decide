import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "get_fragrance_context",
  title: "Get fragrance context",
  description:
    "Return recommended fragrance families and wear guidance for a given weather condition, temperature, and occasion.",
  inputSchema: {
    weather: z
      .string()
      .min(1)
      .describe("Current weather, e.g. 'sunny', 'rainy', 'cold', 'humid'."),
    occasion: z
      .string()
      .min(1)
      .describe("Occasion or context, e.g. 'work', 'date', 'gym', 'evening'."),
    temperatureF: z
      .number()
      .optional()
      .describe("Ambient temperature in Fahrenheit. Defaults to 75."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: ({ weather, occasion, temperatureF }) => {
    const temp = temperatureF ?? 75;
    const w = weather.toLowerCase();
    const o = occasion.toLowerCase();

    const families: string[] = [];
    if (temp >= 80 || w.includes("hot") || w.includes("humid") || w.includes("sun")) {
      families.push("Citrus", "Aquatic", "Fresh");
    } else if (temp <= 55 || w.includes("cold") || w.includes("snow")) {
      families.push("Woody", "Amber", "Oriental");
    } else {
      families.push("Aromatic", "Floral", "Green");
    }
    if (w.includes("rain")) families.push("Earthy");

    if (o.includes("date") || o.includes("evening") || o.includes("night")) {
      families.push("Gourmand", "Musk");
    } else if (o.includes("gym") || o.includes("sport")) {
      families.push("Clean", "Fresh");
    }

    const unique = Array.from(new Set(families));
    const guidance = `For ${occasion} in ${weather} conditions (${temp}°F), lean into ${unique
      .slice(0, 3)
      .join(", ")} scent profiles.`;

    return {
      content: [{ type: "text", text: guidance }],
      structuredContent: {
        weather,
        occasion,
        temperatureF: temp,
        recommendedFamilies: unique,
        guidance,
      },
    };
  },
});
