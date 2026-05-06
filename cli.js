#!/usr/bin/env node
/**
 * CLI do JudMap
 * Uso: node cli.js <arquivo.txt> [opções]
 *
 * Opções:
 *   --provider <nome>   Provider de IA: anthropic, google, openai, deepseek, meta, xai, microsoft (padrão: auto)
 *   --modelo <id>       Modelo específico (padrão: modelo padrão do provider)
 *   --grau <grau>       Foco da extração: grau1, grau2, completo (padrão: grau1)
 *   --out <arquivo>     Salvar resultado em arquivo JSON (padrão: stdout)
 *   --stdin             Ler texto do stdin em vez de arquivo
 */

import { readFileSync, writeFileSync } from 'fs';
import { extrair } from './src/extractor.js';

function parseArgs(argv) {
    const args = argv.slice(2);
    const opts = { provider: 'auto', grau: 'grau1', modelo: undefined, out: null, stdin: false };
    const positional = [];

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--provider') { opts.provider = args[++i]; continue; }
        if (a === '--modelo')   { opts.modelo   = args[++i]; continue; }
        if (a === '--grau')     { opts.grau     = args[++i]; continue; }
        if (a === '--out')      { opts.out      = args[++i]; continue; }
        if (a === '--stdin')    { opts.stdin    = true;       continue; }
        positional.push(a);
    }

    return { opts, arquivo: positional[0] };
}

async function lerStdin() {
    return new Promise((resolve, reject) => {
        let data = '';
        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', chunk => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', reject);
    });
}

async function main() {
    const { opts, arquivo } = parseArgs(process.argv);

    // Lê o texto de entrada
    let texto;
    if (opts.stdin) {
        texto = await lerStdin();
    } else if (arquivo) {
        try {
            texto = readFileSync(arquivo, 'utf-8');
        } catch (e) {
            console.error(`Erro ao ler arquivo "${arquivo}": ${e.message}`);
            process.exit(1);
        }
    } else {
        console.error('Uso: node cli.js <arquivo.txt> [--provider anthropic] [--grau grau1] [--out resultado.json]');
        console.error('     node cli.js --stdin [opções]');
        process.exit(1);
    }

    if (!texto.trim()) {
        console.error('Texto de entrada está vazio.');
        process.exit(1);
    }

    console.error(`[JudMap] Extraindo com provider="${opts.provider}", grau="${opts.grau}"...`);

    let resultado;
    try {
        resultado = await extrair(texto, {
            provider: opts.provider,
            modelo:   opts.modelo,
            grau:     opts.grau,
        });
    } catch (e) {
        console.error(`[JudMap] Erro na extração: ${e.message}`);
        process.exit(1);
    }

    const { json, warnings, alertas, provider, modelo } = resultado;

    // Warnings e alertas vão para stderr
    if (warnings.length) {
        console.error(`\n[JudMap] ${warnings.length} warning(s) de validação de enum:`);
        warnings.forEach(w => console.error(`  ${w}`));
    }
    if (alertas.length) {
        console.error(`\n[JudMap] ${alertas.length} alerta(s) jurídico(s):`);
        alertas.forEach(a => console.error(`  ${a}`));
    }

    const risco = json.grau1?.reus?.[0]?.calculoPrescricao?.risco;
    console.error(`\n[JudMap] Concluído — provider: ${provider}/${modelo} | confiança: ${json.metadados?.confianca ?? '?'} | risco prescrição: ${risco ?? '?'}`);

    const saida = JSON.stringify(json, null, 2);

    if (opts.out) {
        try {
            writeFileSync(opts.out, saida, 'utf-8');
            console.error(`[JudMap] JSON salvo em: ${opts.out}`);
        } catch (e) {
            console.error(`Erro ao salvar "${opts.out}": ${e.message}`);
            process.exit(1);
        }
    } else {
        process.stdout.write(saida + '\n');
    }
}

main();
