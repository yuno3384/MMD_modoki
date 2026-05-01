import { describe, expect, it } from "vitest";

import { analyzeMmeEffectIR } from "./mme-effect-mapper";
import { planMmeFallbackPreset } from "./mme-fallback-preset-planner";
import { parseMmeEffectFile } from "./mme-fx-parser";

describe("planMmeFallbackPreset", () => {
    it("plans basicToon for diffuse-only effects", () => {
        const effect = parseMmeEffectFile({
            path: "basic.fx",
            kind: "fx",
            text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
        });

        const plan = planMmeFallbackPreset(analyzeMmeEffectIR(effect), effect);

        expect(plan.preset).toBe("basicToon");
    });

    it("plans textureToon for diffuse texture or toon ramp effects", () => {
        const effect = parseMmeEffectFile({
            path: "texture.fx",
            kind: "fx",
            text: `
texture MainTex;
texture ToonRamp;
sampler2D MainSampler = sampler_state { Texture = <MainTex>; };
`,
        });

        const plan = planMmeFallbackPreset(analyzeMmeEffectIR(effect), effect);

        expect(plan.preset).toBe("textureToon");
    });

    it("plans katameLike for sphere/specular-heavy effects", () => {
        const effect = parseMmeEffectFile({
            path: "katame.fx",
            kind: "fx",
            text: `
float3 SpecularColor : SPECULAR = float3(1, 1, 1);
float SpecularPower = 32;
texture SphereTex : SPHERE;
`,
        });

        const plan = planMmeFallbackPreset(analyzeMmeEffectIR(effect), effect);

        expect(plan.preset).toBe("katameLike");
    });

    it("plans emissiveLite for emissive effects", () => {
        const effect = parseMmeEffectFile({
            path: "emissive.fx",
            kind: "fx",
            text: `float4 Emissive : EMISSIVE = float4(1, 0.6, 0.2, 1);`,
        });

        const plan = planMmeFallbackPreset(analyzeMmeEffectIR(effect), effect);

        expect(plan.preset).toBe("emissiveLite");
    });

    it("plans unsupported for custom shader or multipass effects", () => {
        const effect = parseMmeEffectFile({
            path: "unsupported.fx",
            kind: "fx",
            text: `
technique Post {
    pass P0 {
        VertexShader = compile vs_3_0 VSMain();
    }
    pass P1 {
        PixelShader = compile ps_3_0 PSMain();
        RenderTarget[1] = Tex;
    }
}
`,
        });

        const plan = planMmeFallbackPreset(analyzeMmeEffectIR(effect), effect);

        expect(plan.preset).toBe("unsupported");
    });

    it("plans unsupported for failed analysis", () => {
        const effect = parseMmeEffectFile({
            path: "empty.fx",
            kind: "fx",
            text: ``,
        });

        const plan = planMmeFallbackPreset(analyzeMmeEffectIR(effect), effect);

        expect(plan.preset).toBe("unsupported");
    });
});
