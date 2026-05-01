import { describe, expect, it } from "vitest";

import { analyzeMmeEffectIR } from "./mme-effect-mapper";
import { createMmeFallbackMaterial } from "./mme-fallback-material-factory";
import { planMmeFallbackPreset } from "./mme-fallback-preset-planner";
import { parseMmeEffectFile } from "./mme-fx-parser";

describe("createMmeFallbackMaterial", () => {
    it("returns unsupported for unsupported plans", () => {
        const effect = parseMmeEffectFile({
            path: "unsupported.fx",
            kind: "fx",
            text: `
technique Post {
    pass P0 {
        PixelShader = compile ps_3_0 PSMain();
    }
}
`,
        });
        const analysis = analyzeMmeEffectIR(effect);
        const plan = planMmeFallbackPreset(analysis, effect);

        const result = createMmeFallbackMaterial({
            scene: null,
            plan,
            analysis,
        });

        expect(result.status).toBe("unsupported");
        expect(result.createdMaterial).toBeUndefined();
    });

    it("returns a dry-run created result for basicToon", () => {
        const effect = parseMmeEffectFile({
            path: "basic.fx",
            kind: "fx",
            text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
        });
        const analysis = analyzeMmeEffectIR(effect);
        const plan = planMmeFallbackPreset(analysis, effect);

        const result = createMmeFallbackMaterial({
            scene: null,
            plan,
            analysis,
            targetMetadata: { targetName: "body" },
        });

        expect(result.status).toBe("created");
        expect(result.materialType).toBe("StandardMaterial");
        expect(result.materialName).toContain("body_basicToon_fallback");
        expect(result.createdMaterial).toBeUndefined();
    });

    it("skips textureToon when no resolved texture path exists", () => {
        const effect = parseMmeEffectFile({
            path: "tex.fx",
            kind: "fx",
            text: `
texture MainTex;
sampler2D DiffuseSampler = sampler_state { Texture = <MainTex>; };
`,
        });
        const analysis = analyzeMmeEffectIR(effect);
        const plan = planMmeFallbackPreset(analysis, effect);

        const result = createMmeFallbackMaterial({
            scene: null,
            plan,
            analysis,
        });

        expect(result.status).toBe("skipped");
        expect(result.warnings.some((warning) => warning.includes("resolved diffuse texture path"))).toBe(true);
    });

    it("returns a dry-run created result for emissiveLite", () => {
        const effect = parseMmeEffectFile({
            path: "emissive.fx",
            kind: "fx",
            text: `float4 Emissive : EMISSIVE = float4(1, 0.5, 0.2, 1);`,
        });
        const analysis = analyzeMmeEffectIR(effect);
        const plan = planMmeFallbackPreset(analysis, effect);

        const result = createMmeFallbackMaterial({
            scene: null,
            plan,
            analysis,
        });

        expect(result.status).toBe("created");
        expect(result.preset).toBe("emissiveLite");
    });

    it("returns unsupported for katameLike because custom shader scaffold is deferred", () => {
        const effect = parseMmeEffectFile({
            path: "katame.fx",
            kind: "fx",
            text: `
float3 SpecularColor : SPECULAR = float3(1, 1, 1);
texture SphereTex : SPHERE;
`,
        });
        const analysis = analyzeMmeEffectIR(effect);
        const plan = planMmeFallbackPreset(analysis, effect);

        const result = createMmeFallbackMaterial({
            scene: null,
            plan,
            analysis,
        });

        expect(result.status).toBe("unsupported");
    });

    it("does not mutate target metadata during dry-run", () => {
        const effect = parseMmeEffectFile({
            path: "basic.fx",
            kind: "fx",
            text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
        });
        const analysis = analyzeMmeEffectIR(effect);
        const plan = planMmeFallbackPreset(analysis, effect);
        const metadata = { targetName: "body", sourcePath: "C:/model/body.fx" };

        createMmeFallbackMaterial({
            scene: null,
            plan,
            analysis,
            targetMetadata: metadata,
        });

        expect(metadata).toEqual({ targetName: "body", sourcePath: "C:/model/body.fx" });
    });
});
