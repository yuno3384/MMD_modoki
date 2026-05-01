/**
 * Minimal MME compatibility manifest discovery.
 *
 * This step performs file discovery and optional partial .fx structural
 * parsing; it does not compile, translate, or execute shaders.
 */
import { parseMmeEffectFile, type MMEEffectIR } from "./mme-fx-parser";

export type MmeCompatFileKind =
    | "x"
    | "fx"
    | "fxsub"
    | "conf"
    | "texture"
    | "unknown";

export type MmeCompatRootKind = MmeCompatFileKind;

export type MmeCompatFileEntry = {
    readonly path: string;
    readonly text?: string | null;
    readonly bytes?: ArrayBuffer | Uint8Array | null;
};

export type MmeTextureCandidate = {
    readonly sourceFile: string;
    readonly reference: string;
    readonly resolvedPath: string | null;
};

export type MMEManifest = {
    readonly rootFile: string;
    readonly rootKind: MmeCompatRootKind;
    readonly discoveredFxFiles: readonly string[];
    readonly discoveredFxSubFiles: readonly string[];
    readonly discoveredConfFiles: readonly string[];
    readonly parsedEffects: Readonly<Record<string, MMEEffectIR>>;
    readonly textureCandidates: readonly MmeTextureCandidate[];
    readonly includeGraph: Readonly<Record<string, readonly string[]>>;
    readonly missingFiles: readonly string[];
    readonly warnings: readonly string[];
};

const TEXTURE_EXTENSIONS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".bmp",
    ".tga",
    ".dds",
    ".spa",
    ".sph",
]);

const INCLUDE_PATTERN = /^\s*#include\s+"([^"\r\n]+)"/gim;
const TEXTURE_REFERENCE_PATTERN = /["']([^"'\r\n]+\.(?:png|jpg|jpeg|bmp|tga|dds|spa|sph))["']/gim;

type IndexedMmeFile = {
    readonly normalizedPath: string;
    readonly kind: MmeCompatFileKind;
    readonly text: string | null;
};

type MmeFileIndex = {
    readonly exact: ReadonlyMap<string, IndexedMmeFile>;
    readonly insensitive: ReadonlyMap<string, readonly IndexedMmeFile[]>;
};

export function normalizeMmePath(path: string): string {
    const slashNormalized = path.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
    const drivePrefixMatch = slashNormalized.match(/^([A-Za-z]:)(?:\/|$)/);
    const hasAbsoluteSlash = !drivePrefixMatch && slashNormalized.startsWith("/");
    const pathWithoutPrefix = drivePrefixMatch
        ? slashNormalized.slice(drivePrefixMatch[0].length)
        : hasAbsoluteSlash
            ? slashNormalized.slice(1)
            : slashNormalized;
    const segments = pathWithoutPrefix.split("/");
    const normalizedSegments: string[] = [];
    for (const segment of segments) {
        if (!segment || segment === ".") continue;
        if (segment === "..") {
            if (normalizedSegments.length > 0 && normalizedSegments[normalizedSegments.length - 1] !== "..") {
                normalizedSegments.pop();
                continue;
            }
        }
        normalizedSegments.push(segment);
    }

    const prefix = drivePrefixMatch ? `${drivePrefixMatch[1]}/` : hasAbsoluteSlash ? "/" : "";
    if (normalizedSegments.length === 0) {
        return prefix || "";
    }
    return `${prefix}${normalizedSegments.join("/")}`;
}

export function getMmeFileKind(path: string): MmeCompatFileKind {
    const normalizedPath = normalizeMmePath(path).toLowerCase();
    if (normalizedPath.endsWith(".x")) return "x";
    if (normalizedPath.endsWith(".fx")) return "fx";
    if (normalizedPath.endsWith(".fxsub")) return "fxsub";
    if (normalizedPath.endsWith(".conf")) return "conf";
    for (const extension of TEXTURE_EXTENSIONS) {
        if (normalizedPath.endsWith(extension)) {
            return "texture";
        }
    }
    return "unknown";
}

export function extractMmeIncludePaths(text: string): readonly string[] {
    const includes: string[] = [];
    for (const match of text.matchAll(INCLUDE_PATTERN)) {
        if (match[1]) {
            includes.push(match[1]);
        }
    }
    return includes;
}

export function extractMmeTexturePathCandidates(text: string): readonly string[] {
    const candidates: string[] = [];
    for (const match of text.matchAll(TEXTURE_REFERENCE_PATTERN)) {
        if (match[1]) {
            candidates.push(match[1]);
        }
    }
    return candidates;
}

export function createMmeManifest(
    rootFile: string,
    files: readonly MmeCompatFileEntry[],
): MMEManifest {
    const warnings: string[] = [];
    const missingFiles = new Set<string>();
    const includeGraph = new Map<string, string[]>();
    const textureCandidates: MmeTextureCandidate[] = [];
    const textureCandidateKeys = new Set<string>();
    const discoveredFxFiles = new Set<string>();
    const discoveredFxSubFiles = new Set<string>();
    const discoveredConfFiles = new Set<string>();
    const parsedEffects = new Map<string, MMEEffectIR>();

    const fileIndex = createMmeFileIndex(files);
    const normalizedRootRequest = normalizeMmePath(rootFile);
    const resolvedRoot = resolveMmePath({
        requestedPath: normalizedRootRequest,
        fileIndex,
        warnings,
    }) ?? normalizedRootRequest;
    const rootKind = getMmeFileKind(resolvedRoot);

    for (const indexedFile of fileIndex.exact.values()) {
        if (indexedFile.kind === "conf") {
            discoveredConfFiles.add(indexedFile.normalizedPath);
        }
    }

    const scannedTextFiles = new Set<string>();
    const scanTextFile = (normalizedPath: string): void => {
        if (scannedTextFiles.has(normalizedPath)) return;
        scannedTextFiles.add(normalizedPath);

        const indexedFile = fileIndex.exact.get(normalizedPath);
        const fileText = indexedFile?.text;
        if (!fileText) {
            includeGraph.set(normalizedPath, []);
            return;
        }

        const resolvedIncludes: string[] = [];
        for (const includePath of extractMmeIncludePaths(fileText)) {
            const resolvedInclude = resolveMmePath({
                requestedPath: includePath,
                baseFile: normalizedPath,
                fileIndex,
                warnings,
            });
            if (resolvedInclude) {
                resolvedIncludes.push(resolvedInclude);
                const includeKind = getMmeFileKind(resolvedInclude);
                if (includeKind === "fx") discoveredFxFiles.add(resolvedInclude);
                if (includeKind === "fxsub") discoveredFxSubFiles.add(resolvedInclude);
                if (includeKind === "conf") discoveredConfFiles.add(resolvedInclude);
                if (includeKind === "fx" || includeKind === "fxsub" || includeKind === "conf") {
                    scanTextFile(resolvedInclude);
                }
            } else {
                const missingPath = normalizeMmePath(joinMmePaths(getMmeDirectory(normalizedPath), includePath));
                missingFiles.add(missingPath);
            }
        }
        includeGraph.set(normalizedPath, resolvedIncludes);

        for (const texturePath of extractMmeTexturePathCandidates(fileText)) {
            const resolvedTexturePath = resolveMmePath({
                requestedPath: texturePath,
                baseFile: normalizedPath,
                fileIndex,
                warnings,
            });
            const candidateKey = `${normalizedPath}::${texturePath}::${resolvedTexturePath ?? ""}`;
            if (textureCandidateKeys.has(candidateKey)) continue;
            textureCandidateKeys.add(candidateKey);
            textureCandidates.push({
                sourceFile: normalizedPath,
                reference: texturePath,
                resolvedPath: resolvedTexturePath,
            });
        }
    };

    if (rootKind === "fx") {
        discoveredFxFiles.add(resolvedRoot);
        scanTextFile(resolvedRoot);
    } else if (rootKind === "fxsub") {
        discoveredFxSubFiles.add(resolvedRoot);
        scanTextFile(resolvedRoot);
    } else if (rootKind === "conf") {
        discoveredConfFiles.add(resolvedRoot);
        scanTextFile(resolvedRoot);
    } else if (rootKind === "x") {
        const siblingFxPath = resolveSameNameFxForX(resolvedRoot, fileIndex, warnings);
        if (siblingFxPath) {
            discoveredFxFiles.add(siblingFxPath);
            scanTextFile(siblingFxPath);
        }
    }

    for (const confFile of discoveredConfFiles) {
        scanTextFile(confFile);
    }

    for (const fxFile of discoveredFxFiles) {
        const parsedEffect = parseMmeEffectFileEntry(fileIndex, fxFile, "fx");
        if (parsedEffect) {
            parsedEffects.set(fxFile, parsedEffect);
            for (const warning of parsedEffect.warnings) {
                warnings.push(`[${fxFile}] ${warning}`);
            }
        }
    }

    for (const fxSubFile of discoveredFxSubFiles) {
        const parsedEffect = parseMmeEffectFileEntry(fileIndex, fxSubFile, "fxsub");
        if (parsedEffect) {
            parsedEffects.set(fxSubFile, parsedEffect);
            for (const warning of parsedEffect.warnings) {
                warnings.push(`[${fxSubFile}] ${warning}`);
            }
        }
    }

    return {
        rootFile: resolvedRoot,
        rootKind,
        discoveredFxFiles: Array.from(discoveredFxFiles),
        discoveredFxSubFiles: Array.from(discoveredFxSubFiles),
        discoveredConfFiles: Array.from(discoveredConfFiles),
        parsedEffects: Object.freeze(Object.fromEntries(parsedEffects.entries())),
        textureCandidates,
        includeGraph: Object.freeze(Object.fromEntries(
            Array.from(includeGraph.entries()).map(([key, value]) => [key, Object.freeze([...value])]),
        )),
        missingFiles: Array.from(missingFiles),
        warnings,
    };
}

export function resolveSameNameFxForX(
    xFilePath: string,
    fileIndex: MmeFileIndex | readonly MmeCompatFileEntry[],
    warnings: string[] = [],
): string | null {
    const normalizedXPath = normalizeMmePath(xFilePath);
    if (getMmeFileKind(normalizedXPath) !== "x") {
        return null;
    }

    const resolvedIndex: MmeFileIndex = isMmeCompatFileEntryList(fileIndex)
        ? createMmeFileIndex(fileIndex)
        : fileIndex;
    const siblingFxPath = `${normalizedXPath.slice(0, -2)}.fx`;
    return resolveMmePath({
        requestedPath: siblingFxPath,
        fileIndex: resolvedIndex,
        warnings,
    });
}

function createMmeFileIndex(files: readonly MmeCompatFileEntry[]): MmeFileIndex {
    const exact = new Map<string, IndexedMmeFile>();
    const insensitive = new Map<string, IndexedMmeFile[]>();

    for (const file of files) {
        const normalizedPath = normalizeMmePath(file.path);
        const indexedFile: IndexedMmeFile = {
            normalizedPath,
            kind: getMmeFileKind(normalizedPath),
            text: readMmeText(file),
        };
        exact.set(normalizedPath, indexedFile);
        const lowerPath = normalizedPath.toLowerCase();
        const entries = insensitive.get(lowerPath);
        if (entries) {
            entries.push(indexedFile);
        } else {
            insensitive.set(lowerPath, [indexedFile]);
        }
    }

    return {
        exact,
        insensitive,
    };
}

function readMmeText(file: MmeCompatFileEntry): string | null {
    if (typeof file.text === "string") {
        return file.text;
    }
    if (!file.bytes) {
        return null;
    }

    const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
    const utf8Text = safeDecodeText(bytes, "utf-8");
    const shiftJisText = safeDecodeText(bytes, "shift-jis");
    if (utf8Text && shiftJisText) {
        return countReplacementChars(shiftJisText) < countReplacementChars(utf8Text)
            ? shiftJisText
            : utf8Text;
    }
    return utf8Text ?? shiftJisText ?? new TextDecoder().decode(bytes);
}

function resolveMmePath(params: {
    requestedPath: string;
    baseFile?: string;
    fileIndex: Readonly<{ exact: ReadonlyMap<string, IndexedMmeFile>; insensitive: ReadonlyMap<string, readonly IndexedMmeFile[]> }>;
    warnings: string[];
}): string | null {
    const requestedPath = params.baseFile && !isMmeAbsolutePath(params.requestedPath)
        ? normalizeMmePath(joinMmePaths(getMmeDirectory(params.baseFile), params.requestedPath))
        : normalizeMmePath(params.requestedPath);

    if (params.fileIndex.exact.has(requestedPath)) {
        return requestedPath;
    }

    const insensitiveMatches = params.fileIndex.insensitive.get(requestedPath.toLowerCase());
    if (insensitiveMatches && insensitiveMatches.length > 0) {
        const resolvedPath = insensitiveMatches[0].normalizedPath;
        if (insensitiveMatches.length > 1) {
            params.warnings.push(`Ambiguous case-insensitive path match for: ${params.requestedPath}`);
        }
        params.warnings.push(`Case-insensitive path fallback used: ${params.requestedPath} -> ${resolvedPath}`);
        return resolvedPath;
    }

    return null;
}

function getMmeDirectory(path: string): string {
    const normalizedPath = normalizeMmePath(path);
    const lastSlashIndex = normalizedPath.lastIndexOf("/");
    if (lastSlashIndex < 0) return "";
    return normalizedPath.slice(0, lastSlashIndex);
}

function joinMmePaths(basePath: string, relativePath: string): string {
    if (!basePath) {
        return relativePath;
    }
    return `${basePath}/${relativePath}`;
}

function isMmeAbsolutePath(path: string): boolean {
    return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/");
}

function safeDecodeText(bytes: Uint8Array, encoding: string): string | null {
    try {
        return new TextDecoder(encoding, { fatal: false }).decode(bytes);
    } catch {
        return null;
    }
}

function countReplacementChars(text: string): number {
    return (text.match(/\uFFFD/g) ?? []).length;
}

function isMmeCompatFileEntryList(value: MmeFileIndex | readonly MmeCompatFileEntry[]): value is readonly MmeCompatFileEntry[] {
    return Array.isArray(value);
}

function parseMmeEffectFileEntry(
    fileIndex: MmeFileIndex,
    normalizedPath: string,
    kind: "fx" | "fxsub",
): MMEEffectIR | null {
    const fileEntry = fileIndex.exact.get(normalizedPath);
    if (!fileEntry?.text) {
        return null;
    }
    return parseMmeEffectFile({
        path: normalizedPath,
        kind,
        text: fileEntry.text,
    });
}
