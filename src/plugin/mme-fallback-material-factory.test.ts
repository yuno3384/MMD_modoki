import { describe, expect, it, vi } from "vitest";

vi.mock("@babylonjs/core/Materials/standardMaterial", () => ({
    StandardMaterial: class StandardMaterial {
        public name: string;
        public scene: unknown;
        public diffuseColor: unknown = null;
        public emissiveColor: unknown = null;
        public specularColor: unknown = null;
        public specularPower = 64;
        public alpha = 1;
        public readonly dispose = vi.fn();

        public constructor(name: string, scene: unknown) {
            this.name = name;
            this.scene = scene;
        }
    },
}));

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

    it("maps diffuse color, alpha, and specular fields safely for basicToon", () => {
        const effect = parseMmeEffectFile({
            path: "basic.fx",
            kind: "fx",
            text: `
float4 Diffuse : DIFFUSE = float4(0.5, 0.25, 0.75, 1.4);
float3 SpecularColor : SPECULAR = float3(255, 128, 0);
float SpecularPower = 0.5;
float Alpha = 2.0;
`,
        });
        const analysis = analyzeMmeEffectIR(effect);
        const plan = planMmeFallbackPreset(analysis, effect);

        const result = createMmeFallbackMaterial({
            scene: {} as never,
            plan,
            analysis,
            dryRun: false,
        });

        expect(result.status).toBe("created");
        const material = result.createdMaterial as unknown as {
            diffuseColor: { r: number; g: number; b: number };
            alpha: number;
            specularColor: { r: number; g: number; b: number };
            specularPower: number;
        };
        expect(material.diffuseColor).toMatchObject({
            r: 0.5,
            g: 0.25,
            b: 0.75,
        });
        expect(material.alpha).toBe(1);
        expect(material.specularColor).toMatchObject({
            r: 1,
            b: 0,
        });
        expect(material.specularColor.g).toBeCloseTo(128 / 255, 5);
        expect(material.specularPower).toBe(32);
    });

    it("clamps alpha safely for basicToon without allocating in dry-run", () => {
        const effect = parseMmeEffectFile({
            path: "alpha.fx",
            kind: "fx",
            text: `float4 Diffuse : DIFFUSE = float4(2, 0, 0, -1);`,
        });
        const analysis = analyzeMmeEffectIR(effect);
        const plan = planMmeFallbackPreset(analysis, effect);

        const dryRunResult = createMmeFallbackMaterial({
            scene: null,
            plan,
            analysis,
            dryRun: true,
        });

        expect(dryRunResult.status).toBe("created");
        expect(dryRunResult.createdMaterial).toBeUndefined();

        const allocatedResult = createMmeFallbackMaterial({
            scene: {} as never,
            plan,
            analysis,
            dryRun: false,
        });

        expect(allocatedResult.status).toBe("created");
        expect((allocatedResult.createdMaterial as { alpha: number }).alpha).toBe(0);
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

    it("does not assign emissive color during basicToon mapping", () => {
        const effect = parseMmeEffectFile({
            path: "basic-emissive.fx",
            kind: "fx",
            text: `
float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);
float4 Emissive : EMISSIVE = float4(1, 0.5, 0.2, 1);
`,
        });
        const analysis = analyzeMmeEffectIR(effect);
        const plan = planMmeFallbackPreset(analysis, effect);

        const result = createMmeFallbackMaterial({
            scene: {} as never,
            plan,
            analysis,
            dryRun: false,
        });

        expect(result.status).toBe("created");
        expect((result.createdMaterial as unknown as { emissiveColor: unknown }).emissiveColor).toBeNull();
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
