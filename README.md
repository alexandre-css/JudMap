# JudMap

Motor de extração de sentenças judiciais criminais para JSON estruturado, com suporte a dosimetria penal, prescrição, lei penal no tempo e validação de enums.

## Requisitos

- Node.js ≥ 18
- Chave de API de ao menos um dos providers suportados

## Instalação

```bash
npm install
```

## Configuração

Crie um arquivo `.env` na raiz do projeto com a chave do provider desejado:

```
JUDMAP_ANTHROPIC_KEY=sk-ant-...
JUDMAP_GOOGLE_KEY=AIza...
JUDMAP_OPENAI_KEY=sk-...
JUDMAP_DEEPSEEK_KEY=...
JUDMAP_GROQ_KEY=...          # provider "meta" (Llama via Groq)
JUDMAP_XAI_KEY=...           # provider "xai" (Grok)
JUDMAP_MICROSOFT_KEY=...     # provider "microsoft" (Azure)
```

## Uso

```bash
# Arquivo de texto ou markdown
node cli.js sentenca.txt

# Leitura do stdin
cat sentenca.txt | node cli.js --stdin

# Salvar resultado em arquivo
node cli.js sentenca.txt --out resultado.json

# Provider e modelo específicos
node cli.js sentenca.txt --provider anthropic --modelo claude-opus-4-5

# Foco em grau 2 (acórdão)
node cli.js acordao.txt --grau grau2

# Extração completa (grau 1 + grau 2)
node cli.js processo.txt --grau completo
```

### Opções

| Opção        | Descrição                                      | Padrão                                 |
| ------------ | ---------------------------------------------- | -------------------------------------- |
| `--provider` | Provider de IA                                 | `auto` (primeiro com chave disponível) |
| `--modelo`   | ID do modelo                                   | Modelo padrão do provider              |
| `--grau`     | Foco da extração: `grau1`, `grau2`, `completo` | `grau1`                                |
| `--out`      | Arquivo de saída JSON                          | stdout                                 |
| `--stdin`    | Lê texto do stdin                              | —                                      |

### Providers e modelos padrão

| Provider    | Variável de ambiente   | Modelo padrão                               |
| ----------- | ---------------------- | ------------------------------------------- |
| `anthropic` | `JUDMAP_ANTHROPIC_KEY` | `claude-sonnet-4-6`                         |
| `google`    | `JUDMAP_GOOGLE_KEY`    | `gemini-3-flash-preview`                    |
| `openai`    | `JUDMAP_OPENAI_KEY`    | `gpt-4o-mini`                               |
| `deepseek`  | `JUDMAP_DEEPSEEK_KEY`  | `deepseek-chat`                             |
| `meta`      | `JUDMAP_GROQ_KEY`      | `meta-llama/llama-4-scout-17b-16e-instruct` |
| `xai`       | `JUDMAP_XAI_KEY`       | `grok-3-fast`                               |
| `microsoft` | `JUDMAP_MICROSOFT_KEY` | `gpt-4o`                                    |

## Saída

O resultado é um JSON estruturado conforme `sentenca_schema.json` (schema v6). Warnings de validação e o resumo de confiança/prescrição são emitidos no `stderr`; o JSON vai para `stdout` (ou para o arquivo indicado em `--out`).

Exemplo de saída no stderr:

```
[JudMap] Extraindo com provider="google", grau="grau1"...
[JudMap] Concluído — provider: google/gemini-3-flash-preview | confiança: 0.95 | risco prescrição: sem_risco
[JudMap] JSON salvo em: resultado.json
```

## Pipeline interno

A extração percorre 7 etapas em sequência:

1. **Construção do prompt** — monta o prompt com o schema, enums e texto da sentença (`src/prompt-builder.js`)
2. **Chamada à IA** — envia para o provider escolhido com retry/backoff (`src/ai-client.js`)
3. **Parse da resposta** — extrai o JSON da resposta, tolerando markdown e texto ao redor (`src/extractor.js`)
4. **Validação de enums** — substitui valores inválidos por `null` e emite warnings (`src/validator.js`)
5. **Cálculo de campos derivativos** — `totalDias`, prescrição, risco prescricional, súmulas violadas, penas abstratas (`src/calculator.js`)
6. **Lei penal no tempo** — alerta sobre aplicação retroativa ou ultra-ativa para fatos anteriores a alterações legislativas (`src/lei-tempo.js`)
7. **Stamp de metadados** — registra provider, modelo, timestamp e confiança

## Estrutura do projeto

```
cli.js                      Entrada de linha de comando
sentenca_schema.json        Schema completo do JSON de saída (v6)
enum.json                   Valores válidos para todos os campos categóricos
leis/
  index_penas.json          Penas abstratas por lei/artigo (lookup de dosimetria)
  index_dosimetria.json     Frações legais por causa de aumento/diminuição
  historico_legislativo.json Alterações legislativas para análise intertemporal
  rag/                      Textos dos artigos por lei (lazy-loaded)
  jsonld/                   Leis em JSON-LD (fonte dos textos)
  md/                       Leis em Markdown
src/
  extractor.js              Orquestrador do pipeline (7 etapas)
  ai-client.js              Cliente unificado de IA (7 providers)
  calculator.js             Cálculos determinísticos (prescrição, totalDias, etc.)
  validator.js              Validação de enums e alertas automáticos
  prompt-builder.js         Construção do prompt com schema e enums
  lei-lookup.js             Lookup de penas e textos legais por dispositivo
  lei-tempo.js              Lei penal no tempo (art. 2º CP)
jurisprudencia/
  sumulas/                  Súmulas do STF, STJ e ECA
  temas/                    Temas repetitivos do STF e STJ
sentencas_reais/            Sentenças reais para testes de integração
test/
  testar_pipeline.mjs       Teste de pipeline completo (sem IA — fixture manual)
  exemplos/                 Resultados de extrações salvas
```

## Leis cobertas

CP, CPP, CTB, Lei de Drogas (11.343/2006), Estatuto do Desarmamento, Lei de Crimes Hediondos, LEP, ECA, Lei Maria da Penha, Lei de Lavagem de Dinheiro, Lei de Crime Organizado, Lei de Abuso de Autoridade, Lei de Interceptação Telefônica, Pacote Anticrime, e outras.

## Atualização das leis

Para extrair/atualizar os textos das leis a partir do portal do Planalto:

```bash
# Listar leis disponíveis para extração
npm run extract:leis:list

# Extrair lei específica
npm run extract:leis -- --lei codigo_penal
```

## Teste sem IA

Para validar o pipeline com um fixture manual (sem consumir tokens):

```bash
node test/testar_pipeline.mjs
```

Espera-se saída com `Warnings: 0` e `Alertas: 0`.
