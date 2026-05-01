import type { MMEManifest } from "./mme-compat-manifest";
import type { MMEEffectIR, MMEEffectParameter, MMEEffectTexture } from "./mme-fx-parser";

export type MmeEffectSupportStatus = "parsed" | "partiallyMapped" | "unsupported" | "failed";

export type MmeMappedTextureField = {
    readonly name: string;
    readonly resolvedPath: string | null;
};

export type MmeMappedColorField = {
    readonly name: string;
    readonly value: string | null;
};

export type MmeMappedScalarField = {
    readonly name: string;
    readonly value: string | null;
};

export type MmeMappedMaterialFields = {
    readonly diffuseColor: MmeMappedColorField | null;
    readonly diffuseTexture: MmeMappedTextureField | null;
    readonly alpha: MmeMappedScalarField | null;
    readonly specularColor: MmeMappedColorField | null;
    readonly specularIntensity: MmeMappedScalarField | null;
    readonly emissiveColor: MmeMappedColorField | null;
    readonly emissiveTexture: MmeMappedTextureField | null;
    readonly normalMap: MmeMappedTextureField | null;
    readonly toonRamp: MmeMappedTextureField | null;
    readonly sphereMap: MmeMappedTextureField | null;
};

export type MmeEffectAnalysis = {
    readonly status: MmeEffectSupportStatus;
    readonly confidence: number;
    readonly reason: string;
    readonly mappedFields: MmeMappedMaterialFields;
    readonly unsupportedFeatures: readonly string[];
    readonly warnings: readonly string[];
};

export function analyzeMmeEffectIR(
    effect: MMEEffectIR,
    context?: { manifest?: Pick<MMEManifest, "textureCandidates"> },
): MmeEffectAnalysis {
    const warnings = [...effect.warnings];
    const unsupportedFeatures: string[] = [];

    if (isEffectIrEmpty(effect)) {
        return {
            status: "failed",
            confidence: 0,
            reason: "No recognizable effect structure found",
            mappedFields: createEmptyMappedFields(),
            unsupportedFeatures: [],
            warnings: [...warnings, "Effect file did not contain recognizable declarations or techniques"],
        };
    }

    const techniqueCount = effect.techniques.length;
    const totalPassCount = effect.techniques.reduce((sum, technique) => sum + technique.passes.length, 0);
    const hasCustomVertexShader = effect.techniques.some((technique) =>
        technique.passes.some((pass) => pass.vertexShader !== null),
    );
    const hasCustomPixelShader = effect.techniques.some((technique) =>
        technique.passes.some((pass) => pass.pixelShader !== null),
    );
    const hasMultipleRenderTargets = effect.renderTargets.some((renderTarget) => (renderTarget.index ?? 0) > 0)
        || effect.renderTargets.length > 1;
    const hasComplexPasses = techniqueCount > 1
        || totalPassCount > 1
        || effect.techniques.some((technique) => technique.passes.some((pass) => pass.unknownStatements.length > 0));
    const hasRenderTargetDependencies = effect.techniques.some((technique) =>
        technique.passes.some((pass) =>
            pass.renderTargets.some((renderTarget) => /(?:RenderTarget|COLOR\d+)/i.test(renderTarget.assignment ?? "")),
        ),
    );

    if (hasCustomVertexShader) unsupportedFeatures.push("custom vertex shader");
    if (hasCustomPixelShader) unsupportedFeatures.push("custom pixel shader");
    if (hasMultipleRenderTargets) unsupportedFeatures.push("multiple render targets");
    if (hasComplexPasses) unsupportedFeatures.push("complex passes");
    if (hasRenderTargetDependencies) unsupportedFeatures.push("render target dependencies");

    const unknownSemantics = collectUnknownSemantics(effect);
    if (unknownSemantics.length > 0) {
        unsupportedFeatures.push("unknown semantics");
        warnings.push(`Unknown semantics detected: ${unknownSemantics.join(", ")}`);
    }

    const mappedFields = mapMaterialFields(effect, context);
    const mappedFieldCount = countMappedFields(mappedFields);

    if (unsupportedFeatures.length > 0) {
        return {
            status: "unsupported",
            confidence: mappedFieldCount > 0 ? 0.35 : 0.15,
            reason: "Effect uses unsupported programmable or multipass features",
            mappedFields,
            unsupportedFeatures,
            warnings,
        };
    }

    if (mappedFieldCount > 0) {
        return {
            status: "partiallyMapped",
            confidence: Math.min(0.85, 0.3 + mappedFieldCount * 0.08),
            reason: "Common material-like fields were mapped conservatively",
            mappedFields,
            unsupportedFeatures,
            warnings,
        };
    }

    return {
        status: "parsed",
        confidence: 0.25,
        reason: "Effect structure parsed, but no safe fallback material mapping was found",
        mappedFields,
        unsupportedFeatures,
        warnings,
    };
}

function createEmptyMappedFields(): MmeMappedMaterialFields {
    return {
        diffuseColor: null,
        diffuseTexture: null,
        alpha: null,
        specularColor: null,
        specularIntensity: null,
        emissiveColor: null,
        emissiveTexture: null,
        normalMap: null,
        toonRamp: null,
        sphereMap: null,
    };
}

function isEffectIrEmpty(effect: MMEEffectIR): boolean {
    return effect.includes.length === 0
        && effect.parameters.length === 0
        && effect.textures.length === 0
        && effect.samplers.length === 0
        && effect.renderTargets.length === 0
        && effect.techniques.length === 0
        && effect.unknownSnippets.length === 0;
}

function mapMaterialFields(
    effect: MMEEffectIR,
    context?: { manifest?: Pick<MMEManifest, "textureCandidates"> },
): MmeMappedMaterialFields {
    const diffuseColor = findColorParameter(effect.parameters, ["diffuse", "albedo", "color", "basecolor"], ["DIFFUSE", "COLOR"]);
    const alpha = findScalarParameter(effect.parameters, ["alpha", "opacity", "transparency"], ["ALPHA"]);
    const specularColor = findColorParameter(effect.parameters, ["specular", "specularcolor"], ["SPECULAR"]);
    const specularIntensity = findScalarParameter(effect.parameters, ["specularpower", "shininess", "power", "specularintensity"], []);
    const emissiveColor = findColorParameter(effect.parameters, ["emissive", "emission", "selfillum", "glow"], ["EMISSIVE"]);

    return {
        diffuseColor,
        diffuseTexture: findTextureField(effect, context, ["diffuse", "albedo", "main", "base", "tex"], ["DIFFUSE", "COLOR"]),
        alpha,
        specularColor,
        specularIntensity,
        emissiveColor,
        emissiveTexture: findTextureField(effect, context, ["emissive", "emission", "glow", "luminous"], ["EMISSIVE"]),
        normalMap: findTextureField(effect, context, ["normal", "nrm", "bump"], ["NORMAL"]),
        toonRamp: findTextureField(effect, context, ["toon", "ramp"], ["TOON"]),
        sphereMap: findTextureField(effect, context, ["sphere", "sph", "spa", "matcap", "env"], ["SPHERE", "MATCAP"]),
    };
}

function findColorParameter(
    parameters: readonly MMEEffectParameter[],
    nameHints: readonly string[],
    semanticHints: readonly string[],
): MmeMappedColorField | null {
    const parameter = findBestParameter(parameters, nameHints, semanticHints, ["float3", "float4"]);
    if (!parameter) return null;
    return {
        name: parameter.name,
        value: parameter.defaultValue,
    };
}

function findScalarParameter(
    parameters: readonly MMEEffectParameter[],
    nameHints: readonly string[],
    semanticHints: readonly string[],
): MmeMappedScalarField | null {
    const parameter = findBestParameter(parameters, nameHints, semanticHints, ["float", "int", "bool"]);
    if (!parameter) return null;
    return {
        name: parameter.name,
        value: parameter.defaultValue,
    };
}

function findBestParameter(
    parameters: readonly MMEEffectParameter[],
    nameHints: readonly string[],
    semanticHints: readonly string[],
    allowedTypes: readonly string[],
): MMEEffectParameter | null {
    const normalizedNameHints = nameHints.map((hint) => hint.toLowerCase());
    const normalizedSemanticHints = semanticHints.map((hint) => hint.toUpperCase());
    let bestMatch: { parameter: MMEEffectParameter; score: number } | null = null;

    for (const parameter of parameters) {
        if (!allowedTypes.includes(parameter.type)) continue;
        const normalizedName = parameter.name.toLowerCase();
        const normalizedSemantic = parameter.semantic?.toUpperCase() ?? "";
        let score = 0;

        if (normalizedNameHints.some((hint) => normalizedName.includes(hint))) score += 3;
        if (normalizedSemanticHints.some((hint) => normalizedSemantic.includes(hint))) score += 2;
        if (score === 0) continue;

        if (bestMatch === null || score > bestMatch.score) {
            bestMatch = { parameter, score };
        }
    }

    return bestMatch?.parameter ?? null;
}

function findTextureField(
    effect: MMEEffectIR,
    context: { manifest?: Pick<MMEManifest, "textureCandidates"> } | undefined,
    nameHints: readonly string[],
    semanticHints: readonly string[],
): MmeMappedTextureField | null {
    const normalizedNameHints = nameHints.map((hint) => hint.toLowerCase());
    const normalizedSemanticHints = semanticHints.map((hint) => hint.toUpperCase());

    const textureScores = new Map<string, number>();
    for (const texture of effect.textures) {
        const score = scoreTexture(texture, normalizedNameHints, normalizedSemanticHints);
        if (score > 0) {
            textureScores.set(texture.name, score);
        }
    }

    for (const sampler of effect.samplers) {
        const samplerName = sampler.name.toLowerCase();
        const samplerSemantic = sampler.semantic?.toUpperCase() ?? "";
        const samplerScore = Number(normalizedNameHints.some((hint) => samplerName.includes(hint)))
            + Number(normalizedSemanticHints.some((hint) => samplerSemantic.includes(hint)));
        if (samplerScore > 0 && sampler.assignedTexture) {
            textureScores.set(sampler.assignedTexture, (textureScores.get(sampler.assignedTexture) ?? 0) + samplerScore);
        }
    }

    let bestTexture: MMEEffectTexture | null = null;
    let bestScore = 0;
    for (const texture of effect.textures) {
        const score = textureScores.get(texture.name) ?? 0;
        if (score > bestScore) {
            bestTexture = texture;
            bestScore = score;
        }
    }
    if (!bestTexture) return null;

    return {
        name: bestTexture.name,
        resolvedPath: resolveTextureCandidatePath(effect.path, bestTexture.name, context?.manifest),
    };
}

function scoreTexture(
    texture: MMEEffectTexture,
    normalizedNameHints: readonly string[],
    normalizedSemanticHints: readonly string[],
): number {
    const normalizedName = texture.name.toLowerCase();
    const normalizedSemantic = texture.semantic?.toUpperCase() ?? "";
    let score = 0;
    if (normalizedNameHints.some((hint) => normalizedName.includes(hint))) score += 3;
    if (normalizedSemanticHints.some((hint) => normalizedSemantic.includes(hint))) score += 2;
    return score;
}

function resolveTextureCandidatePath(
    sourceFile: string,
    textureName: string,
    manifest: Pick<MMEManifest, "textureCandidates"> | undefined,
): string | null {
    if (!manifest) return null;
    const normalizedTextureName = textureName.toLowerCase();
    const candidate = manifest.textureCandidates.find((entry) => {
        if (entry.sourceFile !== sourceFile) return false;
        const reference = entry.reference.toLowerCase();
        const resolved = entry.resolvedPath?.toLowerCase() ?? "";
        return reference.includes(normalizedTextureName) || resolved.includes(normalizedTextureName);
    });
    return candidate?.resolvedPath ?? null;
}

function collectUnknownSemantics(effect: MMEEffectIR): readonly string[] {
    const knownSemanticPrefixes = [
        "WORLD",
        "VIEW",
        "PROJECTION",
        "WORLDVIEW",
        "WORLDVIEWPROJECTION",
        "COLOR",
        "DIFFUSE",
        "SPECULAR",
        "EMISSIVE",
        "NORMAL",
        "TEXCOORD",
        "POSITION",
        "ALPHA",
        "TOON",
        "SPHERE",
        "MATCAP",
        "TARGET",
    ];

    const semantics = new Set<string>();
    for (const parameter of effect.parameters) {
        if (parameter.semantic) semantics.add(parameter.semantic.toUpperCase());
    }
    for (const texture of effect.textures) {
        if (texture.semantic) semantics.add(texture.semantic.toUpperCase());
    }

    return Array.from(semantics).filter((semantic) =>
        !knownSemanticPrefixes.some((prefix) => semantic.startsWith(prefix)),
    );
}

function countMappedFields(fields: MmeMappedMaterialFields): number {
    return [
        fields.diffuseColor,
        fields.diffuseTexture,
        fields.alpha,
        fields.specularColor,
        fields.specularIntensity,
        fields.emissiveColor,
        fields.emissiveTexture,
        fields.normalMap,
        fields.toonRamp,
        fields.sphereMap,
    ].filter((field) => field !== null).length;
}
