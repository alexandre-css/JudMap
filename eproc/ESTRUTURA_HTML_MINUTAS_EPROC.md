# Estrutura HTML das Minutas do eProc (TJSC)

> Documento de referência para IA que processa minutas judiciais extraídas do sistema eProc do TJSC.
> Descreve o significado semântico de cada classe CSS, estrutura de `<section>` e `data-*` attributes.

---

## 1. Estrutura Geral do Documento

Uma minuta judicial do eProc é composta por **seções sequenciais** (`<section>`), cada uma com um papel semântico específico identificado pelo atributo `data-nome`. A ordem canônica é:

```
identificacao_processo
relator
partes
titulo_relatorio
relatorio
titulo_voto
voto
assinaturas
notas
<footer>
```

O rodapé (`<footer>`) aparece fora das `<section>` e contém metadados de autoria.

---

## 2. Seções (`<section data-nome="...">`)

| `data-nome`              | Conteúdo                                         | Relevância para IA                                                                    |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `identificacao_processo` | Classe processual, número do processo            | Tipo de recurso (Apelação Criminal, Civil…)                                           |
| `relator`                | Nome e cargo do Desembargador relator            | Identifica o autor do voto                                                            |
| `partes`                 | Apelante(s), Apelado(s) com polo e tipo de parte | Quem é réu, MP, vítima, autor                                                         |
| `titulo_relatorio`       | Título fixo "RELATÓRIO" (texto de exibição)      | Marcador estrutural                                                                   |
| `relatorio`              | Narrativa dos fatos, histórico processual        | Contexto do caso — extrair teses da defesa, acusação, parecer PGJ, decisão de 1º grau |
| `titulo_voto`            | Título fixo "VOTO" (texto de exibição)           | Marcador estrutural                                                                   |
| `voto`                   | Fundamentação e dispositivo do relator           | **Núcleo decisório** — extrair ratio decidendi, teses acolhidas/rejeitadas, resultado |
| `assinaturas`            | Tarja de assinatura digital                      | Metadados de autenticidade (data e hora da assinatura)                                |
| `notas`                  | Notas de fim de texto                            | Geralmente vazio (`&nbsp;`)                                                           |

---

## 3. Classes CSS de Parágrafos — Significado Semântico

### 3.1 Texto do Próprio Relator (voz ativa do julgador)

```html
<p class="paragrafoPadrao" data-codtipoconteudo="4" ...>
    Texto de fundamentação...
</p>
```

**Classe: `paragrafoPadrao`**

- É o tipo mais importante: representa a **voz direta do Desembargador relator**.
- Usado tanto no Relatório (narração) quanto no Voto (fundamentação e dispositivo).
- `data-codtipoconteudo="4"` indica conteúdo de autoria do relator.
- `data-codtipoconteudo="1"` indica conteúdo de **template reutilizável** (texto padrão importado de biblioteca, ex: introdução ao Protocolo de Gênero, padrões de prova — mesmo formato visual, mas de autoria compartilhada).
- Contém os títulos numerados do voto (ex: `2.5. PEDIDO ABSOLUTÓRIO`, `3. DISPOSITIVO`).
- **O dispositivo** ("Por tais razões, voto por conhecer…") é sempre um `paragrafoPadrao`.

```html
<p class="paragrafoComRecuo" ...><strong>[a]</strong> Texto de sub-item...</p>
```

**Classe: `paragrafoComRecuo`**

- Sub-itens enumerados dentro de um parágrafo do relator (itens `[a]`, `[b]`, `[c]`…).
- Equivale a uma lista com recuo, mas sem `<ul>/<li>`.
- Indica os sub-fundamentos de cada tese analisada.

---

### 3.2 Citações em Caixa Recuada (tabela cinza)

O eProc usa uma estrutura de tabela para recuar citações visualmente:

```html
<table style="background-color:#f9f9f9; border-collapse:collapse; ...">
    <tbody>
        <tr>
            <td style="background-color:#ffffff; width:90px">
                <!-- margem esquerda branca -->
            </td>
            <td style="background-color:#f9f9f9; width:5px">
                <!-- padding interno -->
            </td>
            <td style="background-color:#f9f9f9; width:465px">
                <!-- CONTEÚDO REAL -->
                <p class="cartaSemRecuo">Texto da citação...</p>
            </td>
            <td style="width:5px"><!-- padding interno --></td>
            <td style="background-color:#ffffff; width:20px">
                <!-- margem direita branca -->
            </td>
        </tr>
    </tbody>
</table>
```

**Classe: `cartaSemRecuo`** (dentro da célula central da tabela cinza)

Pode conter três tipos distintos de conteúdo:

| Contexto no documento                        | O que é                                               |
| -------------------------------------------- | ----------------------------------------------------- |
| Na seção `relatorio`, como transcrição longa | Transcrição da **sentença de 1º grau** ou da denúncia |
| Na seção `voto`, trechos de jurisprudência   | Ementa ou excerto de decisão do STJ/STF/TJSC          |
| Na seção `relatorio`, razões recursais       | Transcrição literal das **alegações das partes**      |

> **Regra prática**: todo `<p class="cartaSemRecuo">` dentro de `<td width:465px>` é conteúdo **transcrito/citado**, não voz do relator.

---

### 3.3 Citações Jurisprudenciais Inline (sem tabela)

```html
<p class="citacao">Texto de ementa ou trecho de decisão...</p>

<p class="citacao2">Texto de citação dentro de citação (sub-citação)...</p>
```

**Classe: `citacao`**

- Citação direta de **jurisprudência, doutrina ou depoimento** sem tabela envoltória.
- Aparece dentro do corpo do voto do relator, recuada por CSS.
- Exemplos: trechos de depoimentos especiais de vítimas, excertos de decisões do STJ, trechos de decisões do STF.
- **Não é voz do relator** — é material transcrito.

**Classe: `citacao2`**

- Citação **aninhada** dentro de outra citação.
- Usada para transcrever trechos de decisões que, por sua vez, citam outra fonte.
- Ex: voto do STF que cita trecho do Protocolo CNJ → o trecho do Protocolo é `citacao2`.

---

### 3.4 Identificação e Partes

```html
<p class="identificacao_processo">
    <span data-classe_processo="94">Apelação Criminal</span>
    <span data-numero_processo="..."
        >Nº <a href="...">5003308-27.2024.8.24.0081</a></span
    >
    <span data-origem_processo="SC">SC</span>
</p>
```

```html
<p class="relator" data-cod_magistrado="8052">
    <span class="tipo_relator">RELATOR</span>:
    <span class="nome_relator">Desembargador ALEXANDRE MORAIS DA ROSA</span>
</p>
```

```html
<p class="parte" data-sin_parte="true" data-id_processo_parte="...">
    <span class="tipo_parte">APELANTE</span>:
    <span class="nome_parte">LEONARDO BORGES (RÉU)</span>
</p>
```

**Atributos relevantes nas partes:**

| Atributo                   | Significado                                                           |
| -------------------------- | --------------------------------------------------------------------- |
| `data-parte_polo="autor"`  | Polo ativo (quem recorre/autora)                                      |
| `data-parte_polo="reu"`    | Polo passivo                                                          |
| `data-sin_parte_entidade`  | `"true"` = pessoa jurídica (MP, Estado); `"false"` = pessoa física    |
| `data-sin_parte_principal` | `"S"` = parte principal; `"N"` = "OS MESMOS"                          |
| `.tipo_parte`              | APELANTE, APELADO, RÉU, AUTOR, etc.                                   |
| `.nome_parte`              | Nome da parte (pode conter anonimização: `<span class="anonimizar">`) |

---

### 3.5 Títulos de Seção

```html
<p class="titulo">RELATÓRIO</p>
<p class="titulo">VOTO</p>
```

Apenas marcadores visuais de separação. O conteúdo real está nas `<section>` correspondentes.

---

### 3.6 Assinatura Digital

```html
<p class="tarja_assinatura">
    Documento eletrônico assinado por
    <b>ALEXANDRE MORAIS DA ROSA, Desembargador</b>, na forma do artigo 1º,
    inciso III, da Lei 11.419... código verificador <b>7751712v26</b> código CRC
    <b>f9531dcf</b>... Data e Hora: 05/05/2026, às 18:04:27
</p>
```

Contém: nome do signatário, data/hora da assinatura, código verificador e CRC.

---

## 4. Rodapé (`<footer>`) — Metadados de Autoria

O `<footer>` está **fora das `<section>`** e contém informações cruciais sobre quem criou e quem editou a minuta:

```html
<footer id="7751712_12">
    <div class="rodape_esquerda">
        <span
            data-numero_processo_rodape="50033082720248240081"
            data-sin_numero_processo_rodape="true"
        >
            5003308-27.2024.8.24.0081
        </span>
    </div>
    <div class="rodape_direita">
        <span
            data-codigo_documento_rodape="7751712"
            data-sin_codigo_documento_rodape="true"
            >7751712</span
        >
        <span
            data-versao_documento_rodape="26"
            data-sin_versao_documento_rodape="true"
            >.V26</span
        >
        <span
            data-usuario_criador_documento_rodape="ALEXANDRE.MORAIS.ROSA"
            data-sin_usuario_criador_documento_rodape="true"
        >
            ALEXANDRE.MORAIS.ROSA©
        </span>
        <span
            data-usuario_editor_documento_rodape="ALEXANDRE.MORAIS.ROSA"
            data-sin_usuario_editor_documento_rodape="true"
        >
            ALEXANDRE.MORAIS.ROSA
        </span>
    </div>
</footer>
```

| `data-*` attribute                      | Conteúdo                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `data-numero_processo_rodape`           | Número do processo (formato CNJ)                                                                          |
| `data-codigo_documento_rodape`          | ID interno do documento no eProc                                                                          |
| `data-versao_documento_rodape`          | Versão do documento (ex: `26` → `.V26`)                                                                   |
| `data-usuario_criador_documento_rodape` | **Login do Desembargador** que criou a minuta (relator)                                                   |
| `data-usuario_editor_documento_rodape`  | **Login do último editor** — pode ser o assessor ou secretário jurídico que redigiu ou finalizou a minuta |

> **Importante**: quando `criador ≠ editor`, o editor é provavelmente o **assessor jurídico** responsável pela redação. Quando são iguais, o relator editou diretamente.

---

## 5. Anonimização de Partes (`class="anonimizar"`)

Nomes de partes podem estar dentro de spans com classe `anonimizar`:

```html
<span data-crc32b="3bbfc083" class="anonimizar">LEONARDO BORGES</span>
```

- O atributo `data-crc32b` é um hash do nome real (para verificação de consistência).
- Quando o sistema de anonimização está ativo, o eProc substitui o conteúdo do span por `[ANONIMIZADO]`.
- Para extração de teses e fundamentação, os nomes podem ser substituídos por `[PARTE]` ou `[VÍTIMA]` conforme o polo.

---

## 6. Links Internos para Eventos do Processo

Dentro dos textos, referências a documentos de eventos aparecem como:

```html
<a
    data-class="widgetlinkdocumento"
    href="controlador.php?acao=exibir_documento_evento&amp;StrNumProcesso=...&amp;iddocumento=...&amp;hash=..."
    data-is2g="false"
    data-numprocesso="50033082720248240081"
    data-iddocumento="311730820538314446609694004496"
>
    evento 3, DOC1
</a>
```

- São links para documentos específicos dos autos (petições, atas, laudos).
- O texto visível segue o padrão `evento N, DOCM`.
- `data-is2g` indica se o documento está no 2º grau (`true`) ou 1º grau (`false`).

---

## 7. `data-codtipoconteudo` — Origem do Conteúdo

| Valor | Significado                                                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------- |
| `"1"` | Conteúdo de **template/biblioteca** (texto padrão reutilizável, ex: seções sobre Protocolo de Gênero, padrões de prova) |
| `"4"` | Conteúdo de **autoria original** do relator neste processo específico                                                   |

> Parágrafos com `data-codtipoconteudo="1"` são textos importados de um banco de modelos e podem ser idênticos em múltiplos acórdãos. Para análise de originalidade ou identificação de teses específicas do caso, priorizar `data-codtipoconteudo="4"`.

---

## 8. Mapa de Extração por Objetivo

| Objetivo de Extração                  | Onde buscar                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Resultado do julgamento (provimento?) | Último `paragrafoPadrao` da `section[data-nome="voto"]`                                               |
| Teses da defesa                       | `paragrafoPadrao` no relatório com marcadores `[a]`, `[b]`… após "Razões recursais"                   |
| Teses do MP (apelação)                | `paragrafoPadrao` após "Razões recursais - Ministério Público"                                        |
| Parecer PGJ                           | `paragrafoPadrao` após "Parecer - Procuradoria-Geral de Justiça"                                      |
| Fundamentação do relator              | `paragrafoPadrao` e `paragrafoComRecuo` na `section[data-nome="voto"]` com `data-codtipoconteudo="4"` |
| Jurisprudência citada                 | `citacao`, `citacao2`, e `cartaSemRecuo` dentro de tabelas cinzas no voto                             |
| Sentença de 1º grau transcrita        | `cartaSemRecuo` dentro de tabela cinza no relatório, após menção ao evento da sentença                |
| Depoimento de vítima/testemunha       | `citacao` no relatório ou no voto, após identificação do depoente                                     |
| Quem redigiu a minuta                 | `footer span[data-usuario_editor_documento_rodape]`                                                   |
| Relator                               | `section[data-nome="relator"] span.nome_relator`                                                      |
| Partes do processo                    | `section[data-nome="partes"] p.parte span.nome_parte`                                                 |

---

## 9. Exemplo Completo Anotado

```html
<!-- SEÇÃO: voto -->
<section data-nome="voto" ...>
    <!-- VOZ DO RELATOR: tese propria, análise do caso -->
    <p class="paragrafoPadrao" data-codtipoconteudo="4">
        <strong>2.5. PEDIDO ABSOLUTÓRIO</strong>
    </p>

    <!-- VOZ DO RELATOR: fundamentação específica do caso -->
    <p class="paragrafoPadrao" data-codtipoconteudo="4">
        Os argumentos devem ser rejeitados. A materialidade, a autoria e a
        culpabilidade estão demonstradas...
    </p>

    <!-- CITAÇÃO: transcrição de depoimento da vítima (classe citacao, não é voz do relator) -->
    <p class="citacao">
        Que não gosta de falar sobre isso; que o seu pai tentou lhe abusar...
    </p>

    <!-- VOZ DO RELATOR: análise da prova (coda após citação de depoimento) -->
    <p class="paragrafoPadrao" data-codtipoconteudo="4">
        A vítima, em depoimento especial, descreveu de modo firme e coerente...
    </p>

    <!-- CITAÇÃO EM CAIXA CINZA: ementa ou trecho de jurisprudência -->
    <table style="background-color:#f9f9f9; ...">
        <tr>
            <td style="width:90px; background-color:#ffffff"></td>
            <!-- margem -->
            <td style="width:5px;  background-color:#f9f9f9"></td>
            <!-- padding -->
            <td style="width:465px; background-color:#f9f9f9">
                <!-- CONTEÚDO -->
                <p class="cartaSemRecuo">
                    No crime de estupro de vulnerável, é possível a aplicação da
                    fração máxima... [STJ, Tema 1202]
                </p>
            </td>
            <td style="width:5px"></td>
            <td style="width:20px; background-color:#ffffff"></td>
        </tr>
    </table>

    <!-- VOZ DO RELATOR: dispositivo (conclusão final do voto) -->
    <p class="paragrafoPadrao" data-codtipoconteudo="4">
        Por tais razões, voto por <strong>conhecer</strong> do recurso e
        <strong>negar-lhe provimento</strong>.
    </p>
</section>

<!-- RODAPÉ: metadados de autoria -->
<footer>
    <span data-usuario_criador_documento_rodape="ALEXANDRE.MORAIS.ROSA"
        >ALEXANDRE.MORAIS.ROSA©</span
    >
    <span data-usuario_editor_documento_rodape="GDBASCHIROTTO"
        >GDBASCHIROTTO</span
    >
    <!--
    criador = ALEXANDRE.MORAIS.ROSA (o relator)
    editor  = GDBASCHIROTTO         (assessor/secretário que fez a redação final)
  -->
</footer>
```

---

## 10. Observações de Consistência

1. **Textos com `data-codtipoconteudo="1"` são idênticos em múltiplos acórdãos** do mesmo relator — foram importados de um template. Não representam análise específica do caso.

2. **A seção `relatorio` pode misturar** voz do relator (`paragrafoPadrao`) com transcrições em tabela cinza (`cartaSemRecuo`). O marcador é sempre a presença ou ausência da tabela cinza envoltória.

3. **`citacao` vs `cartaSemRecuo`**: ambos são conteúdo transcrito, mas `citacao` é CSS inline (sem tabela), enquanto `cartaSemRecuo` está dentro da estrutura de tabela cinza. Semanticamente equivalentes para fins de extração.

4. **A seção `notas`** é quase sempre vazia. Ignorar na extração.

5. **Versão do documento** (`data-versao_documento_rodape`) indica quantas vezes foi salvo. Versões altas (ex: V26) sugerem documento muito editado.
