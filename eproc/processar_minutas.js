/**
 * eproc/processar_minutas.js
 *
 * Processa em lote o arquivo JSON de minutas exportadas do eProc e salva
 * um JSON estruturado + Markdown por acórdão na pasta de saída.
 *
 * Uso:
 *   node eproc/processar_minutas.js [arquivo.json] [--out <dir>] [--md]
 *
 * Padrões:
 *   arquivo.json  → eproc/julgados/minutas-*.json mais recente
 *   --out <dir>   → eproc/julgados/processados/
 *   --md          → também grava .md por acórdão (desligado por padrão)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { resolve, dirname, join, basename } from "path";
import { fileURLToPath } from "url";
import { limparMinuta } from "./cleaner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

let inputPath = null;
let outDir = resolve(__dirname, "julgados", "processados");
let gerarMd = false;

for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") {
        outDir = resolve(args[++i]);
    } else if (args[i] === "--md") {
        gerarMd = true;
    } else if (!args[i].startsWith("--")) {
        inputPath = resolve(args[i]);
    }
}

// Se não forneceu arquivo, tenta achar o mais recente em julgados/
if (!inputPath) {
    const julgadosDir = resolve(__dirname, "julgados");
    let candidatos = [];
    try {
        candidatos = readdirSync(julgadosDir)
            .filter((f) => f.startsWith("minutas-") && f.endsWith(".json"))
            .map((f) => join(julgadosDir, f))
            .sort() // ordem lexicográfica; datas no nome garantem ordem correta
            .reverse();
    } catch {
        // diretório não existe ou sem arquivos
    }
    if (!candidatos.length) {
        console.error(
            "Erro: nenhum arquivo minutas-*.json encontrado em eproc/julgados/.\n" +
                "Forneça o caminho como argumento: node eproc/processar_minutas.js <arquivo.json>",
        );
        process.exit(1);
    }
    inputPath = candidatos[0];
    console.log(`Auto-detectado: ${basename(inputPath)}`);
}

// ---------------------------------------------------------------------------
// Leitura do arquivo de minutas
// ---------------------------------------------------------------------------

let dados;
try {
    dados = JSON.parse(readFileSync(inputPath, "utf-8"));
} catch (err) {
    console.error(`Erro ao ler ${inputPath}: ${err.message}`);
    process.exit(1);
}

const minutas = dados.minutas ?? [];
if (!minutas.length) {
    console.error("Nenhuma minuta encontrada no arquivo.");
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Preparar diretório de saída
// ---------------------------------------------------------------------------

mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// Processamento
// ---------------------------------------------------------------------------

const resumo = {
    fonte: basename(inputPath),
    extraido_em: dados.extraido_em ?? null,
    processado_em: new Date().toISOString(),
    total: minutas.length,
    sucesso: 0,
    erro: 0,
    erros: [],
    acordaos: [],
};

console.log(`\nProcessando ${minutas.length} minutas → ${outDir}\n`);

for (const minuta of minutas) {
    const {
        id_minuta,
        numero_documento,
        numero_processo,
        tipo_documento,
        conteudo_html,
    } = minuta;

    if (!conteudo_html) {
        console.warn(`  [SKIP] ${numero_documento} — sem conteudo_html`);
        resumo.erro++;
        resumo.erros.push({ numero_documento, motivo: "sem conteudo_html" });
        continue;
    }

    let resultado;
    try {
        resultado = limparMinuta(conteudo_html, {
            // Metadados externos disponíveis no envelope JSON
            // (o cleaner extrai os mesmos do HTML, mas podemos usar como fallback)
        });
    } catch (err) {
        console.error(`  [ERRO] ${numero_documento}: ${err.message}`);
        resumo.erro++;
        resumo.erros.push({ numero_documento, motivo: err.message });
        continue;
    }

    // Enriquecer JSON com metadados do envelope (id_minuta vem só do JSON)
    resultado.json.metadados = resultado.json.metadados ?? {};
    resultado.json.metadados.id_minuta = id_minuta;
    resultado.json.metadados.tipo_documento = tipo_documento;

    // Salvar JSON
    const jsonPath = join(outDir, `${numero_documento}.json`);
    writeFileSync(jsonPath, JSON.stringify(resultado.json, null, 2), "utf-8");

    // Salvar Markdown (opcional)
    if (gerarMd) {
        const mdPath = join(outDir, `${numero_documento}.md`);
        writeFileSync(mdPath, resultado.md, "utf-8");
    }

    resumo.sucesso++;
    resumo.acordaos.push({
        numero_documento,
        numero_processo:
            resultado.json.identificacao?.numProcesso ?? numero_processo,
        classeProcessual:
            resultado.json.identificacao?.classeProcessual ?? null,
        relator: resultado.json.relator?.nome ?? null,
        dataAssinatura: resultado.json.dataAssinatura ?? null,
        dispositivo:
            resultado.json.voto?.dispositivo?.texto?.slice(0, 120) ?? null,
    });

    const partes = (resultado.json.partes ?? []).map((p) => p.nome).join(" × ");
    console.log(
        `  [OK]  ${numero_documento} — ${resultado.json.identificacao?.classeProcessual ?? "?"} — ${partes.slice(0, 60)}`,
    );
}

// ---------------------------------------------------------------------------
// Salvar índice resumido
// ---------------------------------------------------------------------------

const indexPath = join(outDir, "_index.json");
writeFileSync(indexPath, JSON.stringify(resumo, null, 2), "utf-8");

console.log(
    `\n✓ Concluído: ${resumo.sucesso} processados, ${resumo.erro} erros.`,
);
console.log(`  Índice: ${indexPath}`);
