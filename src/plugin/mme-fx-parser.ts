export type MMEEffectAnnotation = {
    readonly type: string | null;
    readonly name: string;
    readonly value: string | null;
};

export type MMEEffectParameterType =
    | "bool"
    | "int"
    | "float"
    | "float2"
    | "float3"
    | "float4"
    | "float4x4";

export type MMEEffectParameter = {
    readonly name: string;
    readonly type: MMEEffectParameterType;
    readonly semantic: string | null;
    readonly annotations: readonly MMEEffectAnnotation[];
    readonly defaultValue: string | null;
    readonly arrayLength: string | null;
};

export type MMEEffectTexture = {
    readonly name: string;
    readonly type: string;
    readonly semantic: string | null;
    readonly annotations: readonly MMEEffectAnnotation[];
    readonly defaultValue: string | null;
};

export type MMEEffectSampler = {
    readonly name: string;
    readonly type: string;
    readonly semantic: string | null;
    readonly annotations: readonly MMEEffectAnnotation[];
    readonly assignedTexture: string | null;
    readonly states: Readonly<Record<string, string>>;
    readonly rawBody: string | null;
};

export type MMEEffectRenderTarget = {
    readonly name: string;
    readonly semantic: string | null;
    readonly source: "declaration" | "pass-assignment";
    readonly passName: string | null;
    readonly index: number | null;
    readonly assignment: string | null;
};

export type MMEEffectPass = {
    readonly name: string;
    readonly vertexShader: string | null;
    readonly pixelShader: string | null;
    readonly renderTargets: readonly MMEEffectRenderTarget[];
    readonly unknownStatements: readonly string[];
    readonly rawBody: string;
};

export type MMEEffectTechnique = {
    readonly name: string;
    readonly type: string;
    readonly passes: readonly MMEEffectPass[];
    readonly rawBody: string;
};

export type MMEEffectIR = {
    readonly path: string;
    readonly kind: "fx" | "fxsub";
    readonly includes: readonly string[];
    readonly parameters: readonly MMEEffectParameter[];
    readonly textures: readonly MMEEffectTexture[];
    readonly samplers: readonly MMEEffectSampler[];
    readonly renderTargets: readonly MMEEffectRenderTarget[];
    readonly techniques: readonly MMEEffectTechnique[];
    readonly unknownSnippets: readonly string[];
    readonly warnings: readonly string[];
};

const PARAMETER_TYPES = new Set<MMEEffectParameterType>([
    "bool",
    "int",
    "float",
    "float2",
    "float3",
    "float4",
    "float4x4",
]);

export function parseMmeEffectFile(params: {
    path: string;
    kind: "fx" | "fxsub";
    text: string;
}): MMEEffectIR {
    const warnings: string[] = [];
    const includes: string[] = [];
    const parameters: MMEEffectParameter[] = [];
    const textures: MMEEffectTexture[] = [];
    const samplers: MMEEffectSampler[] = [];
    const renderTargets: MMEEffectRenderTarget[] = [];
    const techniques: MMEEffectTechnique[] = [];
    const unknownSnippets: string[] = [];

    const segments = splitTopLevelSegments(params.text);
    for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith("#include")) {
            const includePath = parseIncludeDirective(trimmed);
            if (includePath) {
                includes.push(includePath);
            } else {
                warnings.push(`Unparsed include directive in ${params.path}`);
                unknownSnippets.push(trimmed);
            }
            continue;
        }

        const technique = parseTechniqueSegment(trimmed, warnings);
        if (technique) {
            techniques.push(technique);
            continue;
        }

        const declaration = parseDeclarationSegment(trimmed, warnings);
        if (declaration === null) {
            unknownSnippets.push(trimmed);
            warnings.push(`Unknown top-level snippet preserved in ${params.path}`);
            continue;
        }

        if (declaration.kind === "parameter") {
            parameters.push(declaration.value);
            continue;
        }
        if (declaration.kind === "texture") {
            textures.push(declaration.value);
            if (isRenderTargetSemantic(declaration.value.semantic)) {
                renderTargets.push({
                    name: declaration.value.name,
                    semantic: declaration.value.semantic,
                    source: "declaration",
                    passName: null,
                    index: extractRenderTargetIndex(declaration.value.semantic),
                    assignment: declaration.value.defaultValue,
                });
            }
            continue;
        }
        if (declaration.kind === "sampler") {
            samplers.push(declaration.value);
            continue;
        }
    }

    for (const technique of techniques) {
        for (const pass of technique.passes) {
            renderTargets.push(...pass.renderTargets);
        }
    }

    return {
        path: params.path,
        kind: params.kind,
        includes,
        parameters,
        textures,
        samplers,
        renderTargets,
        techniques,
        unknownSnippets,
        warnings,
    };
}

function parseIncludeDirective(text: string): string | null {
    const match = text.match(/^\s*#include\s+"([^"\r\n]+)"/i);
    return match?.[1] ?? null;
}

function parseTechniqueSegment(text: string, warnings: string[]): MMEEffectTechnique | null {
    const match = text.match(/^(technique(?:10)?)\s+([A-Za-z_][A-Za-z0-9_]*)?\s*\{/);
    if (!match) {
        return null;
    }

    const body = extractBlockBody(text, text.indexOf("{"));
    if (!body) {
        warnings.push(`Unclosed technique block: ${match[2] ?? "(anonymous)"}`);
        return {
            name: match[2] ?? "(anonymous)",
            type: match[1],
            passes: [],
            rawBody: "",
        };
    }

    const passes: MMEEffectPass[] = [];
    for (const segment of splitTopLevelSegments(body.body)) {
        const trimmed = segment.trim();
        if (!trimmed) continue;
        const pass = parsePassSegment(trimmed, warnings);
        if (pass) {
            passes.push(pass);
        } else {
            warnings.push(`Unknown technique snippet preserved in ${match[2] ?? "(anonymous)"}`);
        }
    }

    return {
        name: match[2] ?? "(anonymous)",
        type: match[1],
        passes,
        rawBody: body.body,
    };
}

function parsePassSegment(text: string, warnings: string[]): MMEEffectPass | null {
    const match = text.match(/^pass\s+([A-Za-z_][A-Za-z0-9_]*)?\s*\{/);
    if (!match) {
        return null;
    }

    const body = extractBlockBody(text, text.indexOf("{"));
    if (!body) {
        warnings.push(`Unclosed pass block: ${match[1] ?? "(anonymous)"}`);
        return {
            name: match[1] ?? "(anonymous)",
            vertexShader: null,
            pixelShader: null,
            renderTargets: [],
            unknownStatements: [],
            rawBody: "",
        };
    }

    let vertexShader: string | null = null;
    let pixelShader: string | null = null;
    const renderTargets: MMEEffectRenderTarget[] = [];
    const unknownStatements: string[] = [];

    for (const statement of splitStatements(body.body)) {
        const trimmed = statement.trim();
        if (!trimmed) continue;

        const vertexMatch = trimmed.match(/^VertexShader\s*=\s*(.+)$/i);
        if (vertexMatch) {
            vertexShader = cleanAssignmentValue(vertexMatch[1]);
            continue;
        }

        const pixelMatch = trimmed.match(/^PixelShader\s*=\s*(.+)$/i);
        if (pixelMatch) {
            pixelShader = cleanAssignmentValue(pixelMatch[1]);
            continue;
        }

        const renderTargetMatch = trimmed.match(/^RenderTarget(?:\[(\d+)\])?\s*=\s*(.+)$/i);
        if (renderTargetMatch) {
            renderTargets.push({
                name: `RenderTarget${renderTargetMatch[1] ? `[${renderTargetMatch[1]}]` : ""}`,
                semantic: null,
                source: "pass-assignment",
                passName: match[1] ?? "(anonymous)",
                index: renderTargetMatch[1] ? Number(renderTargetMatch[1]) : null,
                assignment: cleanAssignmentValue(renderTargetMatch[2]),
            });
            continue;
        }

        unknownStatements.push(trimmed);
    }

    if (unknownStatements.length > 0) {
        warnings.push(`Pass ${match[1] ?? "(anonymous)"} contains ${unknownStatements.length} unparsed statement(s)`);
    }

    return {
        name: match[1] ?? "(anonymous)",
        vertexShader,
        pixelShader,
        renderTargets,
        unknownStatements,
        rawBody: body.body,
    };
}

function parseDeclarationSegment(
    text: string,
    warnings: string[],
):
    | { kind: "parameter"; value: MMEEffectParameter }
    | { kind: "texture"; value: MMEEffectTexture }
    | { kind: "sampler"; value: MMEEffectSampler }
    | null {
    const match = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(\s*\[[^\]]+\])?\s*(?::\s*([A-Za-z_][A-Za-z0-9_]*))?\s*(<[\s\S]*?>)?\s*([\s\S]*)$/);
    if (!match) {
        return null;
    }

    const declarationType = match[1];
    const name = match[2];
    const arrayLength = match[3] ? match[3].slice(1, -1).trim() : null;
    const semantic = match[4] ?? null;
    const annotations = parseAnnotations(match[5] ?? null);
    const remainder = stripTrailingSemicolon(match[6] ?? "");

    if (PARAMETER_TYPES.has(declarationType as MMEEffectParameterType)) {
        return {
            kind: "parameter",
            value: {
                name,
                type: declarationType as MMEEffectParameterType,
                semantic,
                annotations,
                defaultValue: parseInitializerValue(remainder),
                arrayLength,
            },
        };
    }

    if (/^texture/i.test(declarationType)) {
        return {
            kind: "texture",
            value: {
                name,
                type: declarationType,
                semantic,
                annotations,
                defaultValue: parseInitializerValue(remainder),
            },
        };
    }

    if (/^sampler/i.test(declarationType)) {
        return {
            kind: "sampler",
            value: parseSamplerDeclaration({
                name,
                type: declarationType,
                semantic,
                annotations,
                remainder,
                warnings,
            }),
        };
    }

    return null;
}

function parseSamplerDeclaration(params: {
    name: string;
    type: string;
    semantic: string | null;
    annotations: readonly MMEEffectAnnotation[];
    remainder: string;
    warnings: string[];
}): MMEEffectSampler {
    const bodyStart = params.remainder.indexOf("{");
    let rawBody: string | null = null;
    let assignedTexture: string | null = null;
    const states: Record<string, string> = {};

    if (bodyStart >= 0) {
        const block = extractBlockBody(params.remainder, bodyStart);
        rawBody = block?.body ?? null;
        if (!block) {
            params.warnings.push(`Unclosed sampler block for ${params.name}`);
        }
    }

    const textureMatch = (rawBody ?? params.remainder).match(/\bTexture\s*=\s*<\s*([A-Za-z_][A-Za-z0-9_]*)\s*>/i);
    if (textureMatch) {
        assignedTexture = textureMatch[1];
    }

    if (rawBody) {
        for (const statement of splitStatements(rawBody)) {
            const trimmed = statement.trim();
            if (!trimmed) continue;
            const stateMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
            if (stateMatch) {
                states[stateMatch[1]] = cleanAssignmentValue(stateMatch[2]);
            }
        }
    }

    return {
        name: params.name,
        type: params.type,
        semantic: params.semantic,
        annotations: params.annotations,
        assignedTexture,
        states,
        rawBody,
    };
}

function parseAnnotations(text: string | null): readonly MMEEffectAnnotation[] {
    if (!text) return [];
    const inner = text.trim().slice(1, -1);
    const annotations: MMEEffectAnnotation[] = [];
    for (const statement of splitStatements(inner)) {
        const trimmed = statement.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^(?:(string|bool|int|float|float2|float3|float4)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*(.+))?$/);
        if (!match) {
            annotations.push({
                type: null,
                name: trimmed,
                value: null,
            });
            continue;
        }
        annotations.push({
            type: match[1] ?? null,
            name: match[2],
            value: match[3] ? cleanAssignmentValue(match[3]) : null,
        });
    }
    return annotations;
}

function parseInitializerValue(remainder: string): string | null {
    const trimmed = remainder.trim();
    if (!trimmed) return null;
    const initializerMatch = trimmed.match(/^=\s*([\s\S]+)$/);
    return initializerMatch ? cleanAssignmentValue(initializerMatch[1]) : null;
}

function stripTrailingSemicolon(text: string): string {
    return text.trim().replace(/;$/, "").trim();
}

function cleanAssignmentValue(text: string): string {
    return stripTrailingSemicolon(text).trim();
}

function extractBlockBody(text: string, openBraceIndex: number): { body: string; endIndex: number } | null {
    const endIndex = findMatchingBrace(text, openBraceIndex);
    if (endIndex < 0) {
        return null;
    }
    return {
        body: text.slice(openBraceIndex + 1, endIndex),
        endIndex,
    };
}

function splitTopLevelSegments(text: string): readonly string[] {
    const segments: string[] = [];
    let start = 0;
    let braceDepth = 0;
    let parenDepth = 0;
    let angleDepth = 0;
    let stringQuote: '"' | "'" | null = null;
    let lineComment = false;
    let blockComment = false;

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        const nextChar = text[i + 1] ?? "";

        if (lineComment) {
            if (char === "\n") lineComment = false;
            continue;
        }
        if (blockComment) {
            if (char === "*" && nextChar === "/") {
                blockComment = false;
                i += 1;
            }
            continue;
        }
        if (stringQuote) {
            if (char === "\\" && nextChar) {
                i += 1;
                continue;
            }
            if (char === stringQuote) {
                stringQuote = null;
            }
            continue;
        }

        if (char === "/" && nextChar === "/") {
            lineComment = true;
            i += 1;
            continue;
        }
        if (char === "/" && nextChar === "*") {
            blockComment = true;
            i += 1;
            continue;
        }
        if (char === '"' || char === "'") {
            stringQuote = char;
            continue;
        }

        if (char === "{") {
            braceDepth += 1;
            continue;
        }
        if (char === "}") {
            braceDepth = Math.max(0, braceDepth - 1);
            if (braceDepth === 0 && parenDepth === 0 && angleDepth === 0) {
                let end = i + 1;
                while (end < text.length && /\s/.test(text[end])) end += 1;
                if (text[end] === ";") end += 1;
                segments.push(text.slice(start, end));
                start = end;
                i = end - 1;
            }
            continue;
        }
        if (char === "(") {
            parenDepth += 1;
            continue;
        }
        if (char === ")") {
            parenDepth = Math.max(0, parenDepth - 1);
            continue;
        }
        if (char === "<" && braceDepth === 0) {
            angleDepth += 1;
            continue;
        }
        if (char === ">" && braceDepth === 0 && angleDepth > 0) {
            angleDepth -= 1;
            continue;
        }
        if (char === ";" && braceDepth === 0 && parenDepth === 0 && angleDepth === 0) {
            segments.push(text.slice(start, i + 1));
            start = i + 1;
        }
    }

    const tail = text.slice(start).trim();
    if (tail) {
        segments.push(tail);
    }
    return segments;
}

function splitStatements(text: string): readonly string[] {
    return splitTopLevelSegments(text).map((segment) => stripTrailingSemicolon(segment));
}

function findMatchingBrace(text: string, openBraceIndex: number): number {
    let depth = 0;
    let stringQuote: '"' | "'" | null = null;
    let lineComment = false;
    let blockComment = false;

    for (let i = openBraceIndex; i < text.length; i += 1) {
        const char = text[i];
        const nextChar = text[i + 1] ?? "";

        if (lineComment) {
            if (char === "\n") lineComment = false;
            continue;
        }
        if (blockComment) {
            if (char === "*" && nextChar === "/") {
                blockComment = false;
                i += 1;
            }
            continue;
        }
        if (stringQuote) {
            if (char === "\\" && nextChar) {
                i += 1;
                continue;
            }
            if (char === stringQuote) {
                stringQuote = null;
            }
            continue;
        }

        if (char === "/" && nextChar === "/") {
            lineComment = true;
            i += 1;
            continue;
        }
        if (char === "/" && nextChar === "*") {
            blockComment = true;
            i += 1;
            continue;
        }
        if (char === '"' || char === "'") {
            stringQuote = char;
            continue;
        }

        if (char === "{") {
            depth += 1;
        } else if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

function isRenderTargetSemantic(semantic: string | null): boolean {
    return semantic !== null && /^(?:COLOR\d*|RENDERCOLORTARGET\d*)$/i.test(semantic);
}

function extractRenderTargetIndex(semantic: string | null): number | null {
    if (!semantic) return null;
    const match = semantic.match(/(\d+)$/);
    return match ? Number(match[1]) : null;
}
