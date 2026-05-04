import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";

import type { MmeEffectAnalysis } from "./mme-effect-mapper";
import type { MmeFallbackPlan, MmeFallbackPreset } from "./mme-fallback-preset-planner";

export type MmeFallbackMaterialTargetMetadata = {
    readonly targetName?: string | null;
    readonly sourcePath?: string | null;
};

export type MmeFallbackMaterialFactoryResult = {
    readonly status: "created" | "skipped" | "unsupported" | "failed";
    readonly preset: MmeFallbackPreset;
    readonly materialName: string;
    readonly materialType: string;
    readonly warnings: readonly string[];
    readonly createdMaterial?: Material;
};

export function createMmeFallbackMaterial(params: {
    scene: Scene | null;
    plan: MmeFallbackPlan;
    analysis: MmeEffectAnalysis;
    targetMetadata?: MmeFallbackMaterialTargetMetadata;
    dryRun?: boolean;
}): MmeFallbackMaterialFactoryResult {
    const dryRun = params.dryRun ?? true;
    const materialName = buildFallbackMaterialName(params.plan.preset, params.targetMetadata);
    const warnings = [...params.plan.warnings];

    if (params.plan.preset === "unsupported" || params.plan.preset === "none") {
        return {
            status: "unsupported",
            preset: params.plan.preset,
            materialName,
            materialType: "none",
            warnings,
        };
    }

    if (params.plan.missingFields.length > 0) {
        warnings.push(`Missing required fields: ${params.plan.missingFields.join(", ")}`);
        return {
            status: "skipped",
            preset: params.plan.preset,
            materialName,
            materialType: "none",
            warnings,
        };
    }

    if (params.plan.blockedByUnsupportedFeatures.length > 0) {
        warnings.push(`Blocked by unsupported features: ${params.plan.blockedByUnsupportedFeatures.join(", ")}`);
        return {
            status: "unsupported",
            preset: params.plan.preset,
            materialName,
            materialType: "none",
            warnings,
        };
    }

    if (params.plan.preset === "katameLike") {
        warnings.push("katameLike fallback would require a custom shader-style material scaffold; not created in this step");
        return {
            status: "unsupported",
            preset: params.plan.preset,
            materialName,
            materialType: "custom-shader-required",
            warnings,
        };
    }

    if (params.plan.preset === "textureToon" && params.analysis.mappedFields.diffuseTexture?.resolvedPath == null) {
        warnings.push("textureToon fallback requires a resolved diffuse texture path for safe scaffold creation");
        return {
            status: "skipped",
            preset: params.plan.preset,
            materialName,
            materialType: "StandardMaterial",
            warnings,
        };
    }

    if (dryRun) {
        if (params.plan.preset === "textureToon") {
            warnings.push("Dry-run only: texture loading and assignment are deferred");
        }
        return {
            status: "created",
            preset: params.plan.preset,
            materialName,
            materialType: "StandardMaterial",
            warnings,
        };
    }

    if (!params.scene) {
        return {
            status: "failed",
            preset: params.plan.preset,
            materialName,
            materialType: "StandardMaterial",
            warnings: [...warnings, "Scene is required to allocate a Babylon material when dryRun is false"],
        };
    }

    const material = new StandardMaterial(materialName, params.scene);
    applyScaffoldMaterialValues(material, params.plan, params.analysis, warnings);

    return {
        status: "created",
        preset: params.plan.preset,
        materialName,
        materialType: "StandardMaterial",
        warnings,
        createdMaterial: material,
    };
}

/**
 * Disposes a fallback material produced by this scaffold.
 *
 * Accepts either a full factory result object or a raw Babylon Material instance.
 * Null/undefined values and dry-run results without a created material are ignored safely.
 * Callers remain responsible for ensuring the material is no longer in active use before disposal.
 */
export function disposeMmeFallbackMaterial(
    resultOrMaterial: MmeFallbackMaterialFactoryResult | Material | null | undefined,
): void {
    if (!resultOrMaterial) {
        return;
    }

    if (isFactoryResult(resultOrMaterial)) {
        resultOrMaterial.createdMaterial?.dispose();
        return;
    }

    resultOrMaterial.dispose();
}

function isFactoryResult(
    value: MmeFallbackMaterialFactoryResult | Material,
): value is MmeFallbackMaterialFactoryResult {
    return "status" in value && "materialType" in value;
}

function buildFallbackMaterialName(
    preset: MmeFallbackPreset,
    targetMetadata: MmeFallbackMaterialTargetMetadata | undefined,
): string {
    const targetName = targetMetadata?.targetName?.trim() || "mme-target";
    return `${targetName}_${preset}_fallback`;
}

function applyScaffoldMaterialValues(
    material: StandardMaterial,
    plan: MmeFallbackPlan,
    analysis: MmeEffectAnalysis,
    warnings: string[],
): void {
    const mappedFields = analysis.mappedFields;
    const diffuseColor = parseColorValue(mappedFields.diffuseColor?.value ?? null);
    const emissiveColor = parseColorValue(mappedFields.emissiveColor?.value ?? null);
    const alphaValue = parseScalarValue(mappedFields.alpha?.value ?? null);
    const specularColor = parseColorValue(mappedFields.specularColor?.value ?? null);
    const specularIntensity = parseScalarValue(mappedFields.specularIntensity?.value ?? null);

    if (diffuseColor) {
        material.diffuseColor = diffuseColor.color;
        if (diffuseColor.alpha !== null) {
            material.alpha = diffuseColor.alpha;
        }
    }
    if (alphaValue !== null) {
        material.alpha = clampUnit(alphaValue);
    }

    if (plan.preset === "basicToon") {
        if (specularColor) {
            material.specularColor = specularColor.color;
        }
        if (specularIntensity !== null) {
            material.specularPower = toSafeSpecularPower(specularIntensity);
        }
    }

    if (plan.preset === "emissiveLite" && emissiveColor === null) {
        material.emissiveColor = new Color3(0.1, 0.1, 0.1);
        warnings.push("Emissive fallback scaffold used a minimal default emissive color");
    } else if (plan.preset === "emissiveLite" && emissiveColor) {
        material.emissiveColor = emissiveColor.color;
    }

    if (plan.preset === "textureToon") {
        warnings.push("Texture-capable scaffold created without loading or binding texture assets in this step");
    }
}

function parseColorValue(value: string | null): { color: Color3; alpha: number | null } | null {
    if (!value) return null;
    const numbers = extractNumericComponents(value);
    if (numbers.length < 3) return null;
    const [r, g, b, a] = numbers;
    return {
        color: new Color3(
            normalizeColorComponent(r),
            normalizeColorComponent(g),
            normalizeColorComponent(b),
        ),
        alpha: typeof a === "number" ? clampUnit(normalizeColorComponent(a)) : null,
    };
}

function parseScalarValue(value: string | null): number | null {
    if (!value) return null;
    const numbers = extractNumericComponents(value);
    return numbers.length > 0 ? numbers[0] : null;
}

function extractNumericComponents(value: string): number[] {
    return Array.from(value.matchAll(/-?\d+(?:\.\d+)?/g))
        .map((match) => Number(match[0]))
        .filter((numberValue) => Number.isFinite(numberValue));
}

function normalizeColorComponent(value: number): number {
    if (value <= 1 && value >= 0) {
        return value;
    }
    if (value > 1 && value <= 255) {
        return clampUnit(value / 255);
    }
    return clampUnit(value);
}

function clampUnit(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function toSafeSpecularPower(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    if (value >= 0 && value <= 1) {
        return Math.min(128, Math.max(0, value * 64));
    }
    return Math.min(128, Math.max(0, value));
}
