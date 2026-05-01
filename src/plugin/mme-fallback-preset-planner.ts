import type { MMEManifest } from "./mme-compat-manifest";
import type { MmeEffectAnalysis } from "./mme-effect-mapper";
import type { MMEEffectIR } from "./mme-fx-parser";

export type MmeFallbackPreset =
    | "none"
    | "basicToon"
    | "textureToon"
    | "katameLike"
    | "emissiveLite"
    | "unsupported";

export type MmeFallbackPlan = {
    readonly preset: MmeFallbackPreset;
    readonly confidence: number;
    readonly reasons: readonly string[];
    readonly requiredFields: readonly string[];
    readonly optionalFields: readonly string[];
    readonly missingFields: readonly string[];
    readonly blockedByUnsupportedFeatures: readonly string[];
    readonly warnings: readonly string[];
};

export function planMmeFallbackPreset(
    analysis: MmeEffectAnalysis,
    effect?: MMEEffectIR,
    context?: { manifest?: Pick<MMEManifest, "textureCandidates"> },
): MmeFallbackPlan {
    void context;
    const warnings = [...analysis.warnings];
    const blockedByUnsupportedFeatures = [...analysis.unsupportedFeatures];

    if (analysis.status === "failed" || analysis.status === "unsupported") {
        return {
            preset: "unsupported",
            confidence: 0.05,
            reasons: [
                analysis.status === "failed"
                    ? "Effect analysis failed before fallback planning"
                    : "Effect is already marked unsupported by the analyzer",
            ],
            requiredFields: [],
            optionalFields: [],
            missingFields: [],
            blockedByUnsupportedFeatures,
            warnings,
        };
    }

    if (hasSeriousUnsupportedFeatures(blockedByUnsupportedFeatures)) {
        return {
            preset: "unsupported",
            confidence: 0.1,
            reasons: [
                "Fallback preset blocked by serious unsupported effect features",
            ],
            requiredFields: [],
            optionalFields: [],
            missingFields: [],
            blockedByUnsupportedFeatures,
            warnings,
        };
    }

    const fields = analysis.mappedFields;
    const hasDiffuseColor = fields.diffuseColor !== null;
    const hasDiffuseTexture = fields.diffuseTexture !== null;
    const hasToonRamp = fields.toonRamp !== null;
    const hasSphereMap = fields.sphereMap !== null;
    const hasSpecular = fields.specularColor !== null || fields.specularIntensity !== null;
    const hasEmissive = fields.emissiveColor !== null || fields.emissiveTexture !== null;

    if (hasEmissive && !isRenderTargetHeavy(effect)) {
        return {
            preset: "emissiveLite",
            confidence: 0.72,
            reasons: [
                "Emissive color or emissive texture was detected",
                "No render-target-heavy behavior was detected",
            ],
            requiredFields: ["emissiveColor or emissiveTexture"],
            optionalFields: ["diffuseColor", "diffuseTexture"],
            missingFields: [],
            blockedByUnsupportedFeatures,
            warnings,
        };
    }

    if ((hasToonRamp || hasSphereMap || hasSpecular) && !isShaderDependent(effect)) {
        const missingFields = [];
        if (!hasToonRamp && !hasSphereMap) {
            missingFields.push("toonRamp or sphereMap");
        }

        return {
            preset: "katameLike",
            confidence: hasToonRamp || hasSphereMap ? 0.78 : 0.62,
            reasons: [
                "Toon ramp, sphere/matcap, or strong specular-like fields were detected",
                "No custom shader dependency or complex render target flow was detected",
            ],
            requiredFields: ["toonRamp or sphereMap or strong specular-like fields"],
            optionalFields: ["diffuseTexture", "diffuseColor", "specularIntensity"],
            missingFields,
            blockedByUnsupportedFeatures,
            warnings,
        };
    }

    if ((hasDiffuseTexture || hasToonRamp) && blockedByUnsupportedFeatures.length === 0) {
        const missingFields = [];
        if (!hasDiffuseTexture) missingFields.push("diffuseTexture");
        if (!hasToonRamp) missingFields.push("toonRamp");

        return {
            preset: "textureToon",
            confidence: hasDiffuseTexture && hasToonRamp ? 0.8 : 0.68,
            reasons: [
                "Diffuse texture or toon ramp candidate was detected",
                "No serious unsupported features were detected",
            ],
            requiredFields: ["diffuseTexture or toonRamp"],
            optionalFields: ["diffuseColor", "alpha", "sphereMap"],
            missingFields,
            blockedByUnsupportedFeatures,
            warnings,
        };
    }

    if (hasDiffuseColor && blockedByUnsupportedFeatures.length === 0) {
        return {
            preset: "basicToon",
            confidence: 0.64,
            reasons: [
                "Diffuse or albedo color was detected",
                "No serious unsupported features were detected",
            ],
            requiredFields: ["diffuseColor"],
            optionalFields: ["alpha", "specularIntensity"],
            missingFields: [],
            blockedByUnsupportedFeatures,
            warnings,
        };
    }

    return {
        preset: "none",
        confidence: 0.2,
        reasons: [
            "Effect was parsed, but no safe toon/Katame fallback preset could be selected conservatively",
        ],
        requiredFields: [],
        optionalFields: [],
        missingFields: [],
        blockedByUnsupportedFeatures,
        warnings,
    };
}

function hasSeriousUnsupportedFeatures(features: readonly string[]): boolean {
    const seriousFeatures = new Set([
        "custom vertex shader",
        "custom pixel shader",
        "multiple render targets",
        "complex passes",
        "render target dependencies",
    ]);
    return features.some((feature) => seriousFeatures.has(feature));
}

function isRenderTargetHeavy(effect: MMEEffectIR | undefined): boolean {
    if (!effect) return false;
    return effect.renderTargets.length > 1 || effect.techniques.some((technique) => technique.passes.length > 1);
}

function isShaderDependent(effect: MMEEffectIR | undefined): boolean {
    if (!effect) return false;
    return effect.techniques.some((technique) =>
        technique.passes.some((pass) => pass.vertexShader !== null || pass.pixelShader !== null),
    );
}
