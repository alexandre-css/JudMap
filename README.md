# JudMap

Plataforma de extração e estruturação de acórdãos criminais do eProc/TJSC em JSON, com suporte a dosimetria penal, análise de prescrição, lei penal no tempo e extração via LLM para sentenças em texto livre.

## Componentes

O projeto tem dois modos de operação:

### 1. Extrator de minutas eProc (`eproc/`)

Processa HTMLs de minutas de acórdão diretamente do eProc (relatório + voto), sem consumir tokens de IA. Produz JSON estruturado com:

- Identificação: classe processual, órgão julgador, relator, assessor/redator, partes
- Relatório: transcrições tipadas (denúncia, sentença 1G, razões recursais, contrarrazões, parecer PGJ, dispositivo 1G)
- Voto: seções segmentadas com papel semântico (`tese_defesa`, `tese_mp`, `fundamento2g`, `dosimetria`, `dispositivo`), citações classificadas, dosimetria estruturada por fase
- Resultado do acórdão: resultado (enum), dosimetria modificada, nova pena total, novo regime, resultado por polo (defesa/MP)
- Dados de 1º grau: pena, regime, artigos imputados, resultado da sentença recorrida
- Teses recursais: via seção explícita do voto ou fallback pelas transcrições do relatório
- Pessoas: réus (com qualificativos), vítimas, testemunhas, promotor
- Metadados: usuário criador e editor do documento no eProc, versão, CRC

```bash
# Processar lote de minutas (JSON de entrada gerado pelo extrator eProc)
node eproc/processar_minutas.js eproc/julgados/minutas-20260507.json

# Processar HTML avulso
node eproc/cleaner.js minuta.html --out resultado.json --md resultado.md
```

Os JSONs processados ficam em `eproc/julgados/processados/`. Cada arquivo corresponde a um acórdão identificado pelo `numero_documento` do eProc.

### 2. Extrator via LLM (`cli.js`)

Para sentenças em texto livre (PDF, TXT, Markdown), usa IA para extrair os campos do `sentenca_schema.json`:

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
```

#### Opções CLI

| Opção        | Descrição                          | Padrão                                 |
| ------------ | ---------------------------------- | -------------------------------------- |
| `--provider` | Provider de IA                     | `auto` (primeiro com chave disponível) |
| `--modelo`   | ID do modelo                       | Modelo padrão do provider              |
| `--grau`     | Foco: `grau1`, `grau2`, `completo` | `grau1`                                |
| `--out`      | Arquivo de saída JSON              | stdout                                 |
| `--stdin`    | Lê texto do stdin                  | —                                      |

#### Providers suportados

| Provider    | Variável de ambiente   | Modelo padrão                               |
| ----------- | ---------------------- | ------------------------------------------- |
| `anthropic` | `JUDMAP_ANTHROPIC_KEY` | `claude-sonnet-4-6`                         |
| `google`    | `JUDMAP_GOOGLE_KEY`    | `gemini-3-flash-preview`                    |
| `openai`    | `JUDMAP_OPENAI_KEY`    | `gpt-4o-mini`                               |
| `deepseek`  | `JUDMAP_DEEPSEEK_KEY`  | `deepseek-chat`                             |
| `meta`      | `JUDMAP_GROQ_KEY`      | `meta-llama/llama-4-scout-17b-16e-instruct` |
| `xai`       | `JUDMAP_XAI_KEY`       | `grok-3-fast`                               |
| `microsoft` | `JUDMAP_MICROSOFT_KEY` | `gpt-4o`                                    |

Crie `.env` na raiz com as chaves desejadas.

## Requisitos

- Node.js ≥ 18
- Chave de API de ao menos um provider (somente para o modo LLM)

```bash
npm install
```

## Schemas

| Arquivo                | Descrição                                          |
| ---------------------- | -------------------------------------------------- |
| `sentenca_schema.json` | Schema completo grau1 + grau2 (sentença + acórdão) |
| `enum.json`            | Valores válidos para todos os campos categóricos   |

## Estrutura do projeto

```
cli.js                        Entrada CLI (modo LLM)
sentenca_schema.json          Schema JSON de saída (grau1 + grau2)
enum.json                     Enums de todos os campos categóricos
eproc/
  cleaner.js                  Extrator de minutas HTML do eProc
  processar_minutas.js        Processamento em lote
  julgados/
    minutas-*.json            Lote de minutas (entrada)
    processados/              JSONs estruturados por acórdão (saída)
  ESTRUTURA_HTML_MINUTAS_EPROC.md  Documentação da estrutura HTML do eProc
leis/
  index_penas.json            Penas abstratas por lei/artigo
  index_dosimetria.json       Frações legais por causa de aumento/diminuição
  historico_legislativo.json  Alterações legislativas para análise intertemporal
  extrator.js                 Extrai textos das leis do Planalto
  extrator_historico.js       Extrai alterações de pena via texto riscado
  senado_api.js               Resolve dataVigor via API do Senado
  rag/                        Textos dos artigos por lei (lazy-loaded)
  jsonld/                     Leis em JSON-LD
  md/                         Leis em Markdown
jurisprudencia/
  sumulas/                    Súmulas do STF, STJ e ECA
  temas/                      Temas repetitivos do STF e STJ
src/
  extractor.js                Orquestrador do pipeline LLM (7 etapas)
  ai-client.js                Cliente unificado de IA (7 providers)
  calculator.js               Cálculos determinísticos (prescrição, totalDias)
  validator.js                Validação de enums e alertas automáticos
  prompt-builder.js           Construção do prompt com schema e enums
  lei-lookup.js               Lookup de penas e textos legais por dispositivo
  lei-tempo.js                Lei penal no tempo (art. 2º CP)
sentencas_reais/              Sentenças reais para testes
test/
  testar_pipeline.mjs         Teste de pipeline sem IA (fixture manual)
  exemplos/                   Resultados de extrações salvas
```

## Leis cobertas

CP, CPP, CTB, Lei de Drogas (11.343/2006), Estatuto do Desarmamento, Crimes Hediondos, LEP, ECA, Maria da Penha, Lavagem de Dinheiro, Crime Organizado, Abuso de Autoridade, Interceptação Telefônica, Pacote Anticrime, e outras.

## Atualização das leis

```bash
# Extrair/atualizar texto de lei do Planalto
npm run extract:leis -- --lei codigo_penal

# Detectar alterações de pena e estimar dataVigor
node leis/extrator_historico.js --out leis/rascunho_historico.json
node leis/extrator_historico.js --merge
```

## Teste sem IA

```bash
node test/testar_pipeline.mjs
```

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
  historico_legislativo.json Alterações legislativas para análise intertemporal (curado + auto)
  extrator.js               Extrai textos das leis do Planalto (versão compilada → RAG)
  extrator_historico.js     Extrai alterações de pena via texto riscado da versão histórica
  senado_api.js             Resolve dataVigor consultando API do Senado + Planalto
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

## Atualização do histórico legislativo

Para detectar automaticamente alterações de pena (texto riscado na versão não-compilada do Planalto) e estimar `dataVigor` via API do Senado:

```bash
# Gerar rascunho com alterações detectadas em todas as leis
node leis/extrator_historico.js --out leis/rascunho_historico.json

# Filtrar por uma lei
node leis/extrator_historico.js codigo_penal --out rascunho.json

# Mesclar rascunho ao histórico oficial (entradas manuais têm prioridade)
node leis/extrator_historico.js --merge
```

O extrator marca entradas auto-extraídas com `"autoExtraido": true` e classifica `tipo` (`novatio_legis_in_pejus`, `_in_mellius`, `bifacial`) comparando penas riscadas vs. vigentes. Datas resolvidas pela API do Senado caem em fallback para data de publicação quando não há vacatio legis explícita no texto. Casos com vacatio incomum ("no 1º dia do 6º mês após", leis pré-2004 sem URL Planalto) precisam revisão manual — entradas corrigidas devem receber `"revisaoManual": "AAAA-MM-DD"` para rastreabilidade.

## Teste sem IA

Para validar o pipeline com um fixture manual (sem consumir tokens):

```bash
node test/testar_pipeline.mjs
```

Espera-se saída com `Warnings: 0` e `Alertas: 0`.
