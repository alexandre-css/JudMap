#!/usr/bin/env node
/**
 * jurisprudencia/build.js
 *
 * Reestrutura os JSONs de súmulas e temas para o schema do JudMap e
 * gera arquivos Markdown limpos para cada corpus.
 *
 * Saída:
 *   jurisprudencia/sumulas/sumulas_stf.json  — array plano, schema limpo
 *   jurisprudencia/sumulas/sumulas_stj.json  — idem + 7 súmulas ECA fundidas
 *   jurisprudencia/temas/temas_stf.json      — array plano, schema limpo
 *   jurisprudencia/temas/temas_stj.json      — idem
 *   jurisprudencia/md/sumulas_stf.md
 *   jurisprudencia/md/sumulas_stj.md
 *   jurisprudencia/md/temas_stf.md
 *   jurisprudencia/md/temas_stj.md
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

function ler(rel) {
    return JSON.parse(readFileSync(resolve(ROOT, rel), "utf-8"));
}

function escrever(rel, dados) {
    writeFileSync(
        resolve(ROOT, rel),
        JSON.stringify(dados, null, 2) + "\n",
        "utf-8",
    );
    console.log(
        `[build] Escrito: jurisprudencia/${rel}  (${dados.length} itens)`,
    );
}

function escreverMd(rel, conteudo) {
    writeFileSync(resolve(ROOT, rel), conteudo, "utf-8");
    console.log(`[build] Escrito: jurisprudencia/${rel}`);
}

// ---------------------------------------------------------------------------
// Leitura dos dados atuais
// ---------------------------------------------------------------------------

const rawSTF = ler("sumulas/sumulas_stf.json");
const rawSTJ = ler("sumulas/sumulas_stj.json");
const rawECA = ler("sumulas/sumulas_eca.json");
const rawTSTF = ler("temas/temas_stf.json");
const rawTSTJ = ler("temas/temas_stj.json");

// ---------------------------------------------------------------------------
// Transformação: Súmulas
// ---------------------------------------------------------------------------

/**
 * Transforma uma súmula do schema antigo para o novo.
 *
 * Schema novo:
 *   numero         number
 *   tribunal       "STF" | "STJ"
 *   texto          string
 *   vinculante     boolean
 *   superadaEmParte boolean
 *   alterada       boolean
 *   area           string | null   ("ECA" ou null)
 */
function transformarSumula(s, tribunal, area = null) {
    return {
        numero: s.numero,
        tribunal,
        texto: s.texto.trim(),
        vinculante: s.vinculante ?? false,
        superadaEmParte: (s.chips ?? []).includes("SUPERADA EM PARTE"),
        alterada: (s.chips ?? []).includes("ALTERADA"),
        area,
    };
}

const sumulasSTF = rawSTF.sumulas
    .map((s) => transformarSumula(s, "STF"))
    .sort((a, b) => a.numero - b.numero);

// Merge STJ + ECA (ECA marcadas com area="ECA")
const sumulasSTJ = [
    ...rawSTJ.sumulas.map((s) => transformarSumula(s, "STJ")),
    ...rawECA.sumulas.map((s) => transformarSumula(s, "STJ", "ECA")),
].sort((a, b) => a.numero - b.numero);

// ---------------------------------------------------------------------------
// Transformação: Temas
// ---------------------------------------------------------------------------

/**
 * Transforma um tema do schema antigo para o novo.
 *
 * Schema novo:
 *   numero           number
 *   tribunal         "STF" | "STJ"
 *   titulo           string
 *   tese             string
 *   observacao       string | null
 *   modulacaoEfeitos string | null
 */
function transformarTema(t, tribunal) {
    return {
        numero: t.numero,
        tribunal,
        titulo: (t.titulo ?? "").trim(),
        tese: (t.tese ?? "").trim(),
        observacao: t.comentario?.trim() || null,
        modulacaoEfeitos: t.modulacao_efeitos?.trim() || null,
    };
}

const temasSTF = rawTSTF.temas
    .map((t) => transformarTema(t, "STF"))
    .sort((a, b) => a.numero - b.numero);

const temasSTJ = rawTSTJ.temas
    .map((t) => transformarTema(t, "STJ"))
    .sort((a, b) => a.numero - b.numero);

// ---------------------------------------------------------------------------
// Geração de Markdown
// ---------------------------------------------------------------------------

function mdSumulas(sumulas, titulo) {
    const linhas = [`# ${titulo}`, ""];
    for (const s of sumulas) {
        const flags = [];
        if (s.vinculante) flags.push("VINCULANTE");
        if (s.superadaEmParte) flags.push("SUPERADA EM PARTE");
        if (s.alterada) flags.push("ALTERADA");
        if (s.area) flags.push(s.area);

        linhas.push(`## Súmula ${s.tribunal} nº ${s.numero}`);
        if (flags.length) linhas.push(`> ${flags.join(" · ")}`);
        linhas.push("");
        linhas.push(s.texto);
        linhas.push("");
        linhas.push("---");
        linhas.push("");
    }
    return linhas.join("\n");
}

function mdTemas(temas, titulo) {
    const linhas = [`# ${titulo}`, ""];
    for (const t of temas) {
        linhas.push(`## Tema ${t.tribunal} nº ${t.numero} — ${t.titulo}`);
        linhas.push("");
        linhas.push(t.tese);
        linhas.push("");
        if (t.observacao) {
            linhas.push(`> **Obs.:** ${t.observacao}`);
            linhas.push("");
        }
        if (t.modulacaoEfeitos) {
            linhas.push(`> **Modulação de efeitos:** ${t.modulacaoEfeitos}`);
            linhas.push("");
        }
        linhas.push("---");
        linhas.push("");
    }
    return linhas.join("\n");
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

mkdirSync(resolve(ROOT, "md"), { recursive: true });

escrever("sumulas/sumulas_stf.json", sumulasSTF);
escrever("sumulas/sumulas_stj.json", sumulasSTJ);
escrever("temas/temas_stf.json", temasSTF);
escrever("temas/temas_stj.json", temasSTJ);

escreverMd("md/sumulas_stf.md", mdSumulas(sumulasSTF, "Súmulas Criminais STF"));
escreverMd("md/sumulas_stj.md", mdSumulas(sumulasSTJ, "Súmulas Criminais STJ"));
escreverMd(
    "md/temas_stf.md",
    mdTemas(temasSTF, "Temas de Repercussão Geral STF (Criminal)"),
);
escreverMd(
    "md/temas_stj.md",
    mdTemas(temasSTJ, "Temas Repetitivos STJ (Criminal)"),
);

console.log("\n[build] Concluído.");
console.log(`  Súmulas STF: ${sumulasSTF.length}`);
console.log(
    `  Súmulas STJ: ${sumulasSTJ.length} (inclui ${rawECA.sumulas.length} súmulas ECA)`,
);
console.log(`  Temas STF: ${temasSTF.length}`);
console.log(`  Temas STJ: ${temasSTJ.length}`);
