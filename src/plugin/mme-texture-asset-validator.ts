import type { MmeMappedTextureField } from "./mme-effect-mapper";
import {
    getMmeFileKind,
    normalizeMmePath,
    type MmeCompatFileEntry,
} from "./mme-compat-manifest";

export type MmeTextureValidationStatus =
    | "valid"
    | "missing"
    | "unsupported-extension"
    | "unresolved"
    | "ambiguous"
    | "failed";

export type MmeTextureValidationResult = {
    readonly status: MmeTextureValidationStatus;
    readonly reference: string | null;
    readonly resolvedPath: string | null;
    readonly extension: string | null;
    readonly reason: string;
    readonly warnings: readonly string[];
};

export type MmeTextureValidationContext = {
    readonly files?: readonly MmeCompatFileEntry[] | ReadonlyMap<string, MmeCompatFileEntry>;
    readonly allowedExtensions?: readonly string[];
};

export type MmeTextureToonReadinessResult = {
    readonly ready: boolean;
    readonly diffuseTexture: MmeTextureValidationResult;
    readonly warnings: readonly string[];
};

const DEFAULT_ALLOWED_TEXTURE_EXTENSIONS = [
    ".png",
    ".jpg",
    ".jpeg",
    ".bmp",
    ".tga",
    ".dds",
    ".spa",
    ".sph",
] as const;

export function validateMmeTextureCandidate(
    candidate: MmeMappedTextureField | null | undefined,
    context: MmeTextureValidationContext = {},
): MmeTextureValidationResult {
    try {
        if (!candidate) {
            return createTextureValidationResult({
                status: "unresolved",
                reference: null,
                resolvedPath: null,
                extension: null,
                reason: "texture-candidate-missing",
                warnings: ["Texture candidate is missing."],
            });
        }

        const reference = normalizeOptionalPath(candidate.reference);
        const resolvedPath = normalizeOptionalPath(candidate.resolvedPath);

        if (candidate.status === "candidate-only") {
            return createTextureValidationResult({
                status: "ambiguous",
                reference,
                resolvedPath,
                extension: getTextureExtension(resolvedPath ?? reference),
                reason: "texture-candidate-ambiguous",
                warnings: ["Texture candidate is candidate-only and cannot be treated as apply-ready."],
            });
        }

        if (candidate.status !== "resolved" || !resolvedPath) {
            return createTextureValidationResult({
                status: "unresolved",
                reference,
                resolvedPath,
                extension: getTextureExtension(resolvedPath ?? reference),
                reason: "texture-candidate-unresolved",
                warnings: ["Texture candidate is unresolved."],
            });
        }

        const extension = getTextureExtension(resolvedPath);
        const allowedExtensions = normalizeAllowedExtensions(context.allowedExtensions);
        if (!extension || !allowedExtensions.has(extension) || getMmeFileKind(resolvedPath) !== "texture") {
            return createTextureValidationResult({
                status: "unsupported-extension",
                reference,
                resolvedPath,
                extension,
                reason: "texture-extension-unsupported",
                warnings: [`Unsupported texture extension: ${extension ?? "(none)"}`],
            });
        }

        const fileIndex = createRegisteredTextureFileIndex(context.files);
        if (fileIndex && !fileIndex.has(resolvedPath)) {
            return createTextureValidationResult({
                status: "missing",
                reference,
                resolvedPath,
                extension,
                reason: "texture-file-missing",
                warnings: [`Resolved texture is not registered: ${resolvedPath}`],
            });
        }

        return createTextureValidationResult({
            status: "valid",
            reference,
            resolvedPath,
            extension,
            reason: "texture-ready",
            warnings: fileIndex ? [] : ["No registered file context was provided; file existence was not checked."],
        });
    } catch (error) {
        return createTextureValidationResult({
            status: "failed",
            reference: candidate?.reference ?? null,
            resolvedPath: candidate?.resolvedPath ?? null,
            extension: null,
            reason: "texture-validation-failed",
            warnings: [error instanceof Error ? error.message : "Texture validation failed."],
        });
    }
}

export function validateTextureToonReadiness(
    params: {
        readonly diffuseTexture: MmeMappedTextureField | null | undefined;
        readonly context?: MmeTextureValidationContext;
    },
): MmeTextureToonReadinessResult {
    const diffuseTexture = validateMmeTextureCandidate(params.diffuseTexture, params.context);
    const warnings = [...diffuseTexture.warnings];
    if (diffuseTexture.status !== "valid") {
        warnings.push(`textureToon diffuse texture is not apply-ready: ${diffuseTexture.reason}`);
    }

    return {
        ready: diffuseTexture.status === "valid",
        diffuseTexture,
        warnings,
    };
}

function normalizeOptionalPath(path: string | null | undefined): string | null {
    if (typeof path !== "string") return null;
    const trimmed = path.trim();
    if (trimmed.length === 0) return null;
    return normalizeMmePath(trimmed);
}

function getTextureExtension(path: string | null | undefined): string | null {
    if (!path) return null;
    const normalizedPath = normalizeMmePath(path);
    const lastSlash = normalizedPath.lastIndexOf("/");
    const fileName = lastSlash >= 0 ? normalizedPath.slice(lastSlash + 1) : normalizedPath;
    const dotIndex = fileName.lastIndexOf(".");
    if (dotIndex < 0) return null;
    return fileName.slice(dotIndex).toLowerCase();
}

function normalizeAllowedExtensions(extensions: readonly string[] | undefined): ReadonlySet<string> {
    const source = extensions ?? DEFAULT_ALLOWED_TEXTURE_EXTENSIONS;
    return new Set(source.map((extension) => extension.startsWith(".")
        ? extension.toLowerCase()
        : `.${extension.toLowerCase()}`));
}

function createRegisteredTextureFileIndex(
    files: readonly MmeCompatFileEntry[] | ReadonlyMap<string, MmeCompatFileEntry> | undefined,
): ReadonlySet<string> | null {
    if (!files) return null;
    const values = Array.isArray(files) ? files : Array.from(files.values());
    return new Set(values
        .map((file) => normalizeMmePath(file.path))
        .filter((path) => getMmeFileKind(path) === "texture"));
}

function createTextureValidationResult(result: MmeTextureValidationResult): MmeTextureValidationResult {
    return result;
}

