# TASKS.md — Fase 0: PWA real, higiene e peso

Ordem obrigatória. Uma tarefa = um PR. Lê primeiro o `AGENTS.md`.

---

## T0.1 — Higiene do repositório
**Problema:** `supabase/.temp/*` está versionado (inclui `project-ref` e `linked-project.json`).
**Fazer:**
- `git rm -r --cached supabase/.temp` e adicionar `supabase/.temp/` ao `.gitignore`.
- Remover duplicado `node_modules/` no `.gitignore`; acrescentar `.DS_Store`, `*.local`, `dist-ssr/`.
- Verificar que `supabase/migrations/cipherline_todas_migrations_v2.sql` (sem timestamp)
  não é aplicada pelo CLI: se for um ficheiro de arquivo, mover para `supabase/archive/` e
  explicar no PR. **Não apagar nada** sem o dizer.
**Aceitação:** `git ls-files supabase/.temp` vazio; 4 comandos limpos.
**Nota ao dono:** o `project-ref` ficou no histórico do git; não é uma chave, mas convém saber.

---

## T0.2 — PWA instalável (manifest, ícones, metas)
**Fazer:**
1. Criar `public/manifest.webmanifest`:
   `name:"CipherLine"`, `short_name:"CipherLine"`, `description` em português,
   `lang:"pt"`, `start_url:"/"`, `scope:"/"`, `display:"standalone"`, `orientation:"portrait"`,
   `background_color:"#0a0a0f"`, `theme_color:"#0a0a0f"`, ícones 192 e 512 (`purpose:"any"`)
   e 512 (`purpose:"maskable"`).
2. Gerar os ícones PNG a partir de `public/favicon.svg` com um script **pontual** em
   `scripts/make-icons.mjs` (não adicionar dependência permanente; se precisares de `sharp`,
   usa `npx` e não o guardes no `package.json`). Maskable com margem de segurança de 20%.
   Criar também `public/apple-touch-icon.png` (180×180).
3. `index.html`:
   - `<html lang="pt">`
   - viewport: `width=device-width, initial-scale=1, viewport-fit=cover`
   - `<link rel="manifest" href="/manifest.webmanifest">`
   - `<meta name="theme-color" content="#0a0a0f">`
   - `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`
   - `<meta name="mobile-web-app-capable" content="yes">` e
     `<meta name="apple-mobile-web-app-capable" content="yes">`
   - `apple-mobile-web-app-status-bar-style` = `black-translucent`, `apple-mobile-web-app-title` = `CipherLine`
   - `<meta name="description">` em português
   - **Remover** as imagens `bolt.new` do og/twitter. Criar `public/og.png` (1200×630,
     placeholder simples: fundo `#0a0a0f`, texto CIPHERLINE) e apontar para URL absoluto
     lido de uma constante; o design final vem depois.
4. Com `viewport-fit=cover`, confirmar que `.app-viewport` já aplica os `env(safe-area-inset-*)`
   e que o ecrã de login, home e chat não ficam tapados pelo notch nem pela barra inferior.
**Aceitação:** Lighthouse (aba PWA/Installable, Chrome DevTools) sem erros de manifest;
"Adicionar ao ecrã principal" disponível no Android; ícone e cor de arranque corretos;
nenhum pedido a `bolt.new` no separador Network. 4 comandos limpos.

---

## T0.3 — Service worker: cache do essencial e modo offline
**Contexto:** `public/sw.js` hoje só trata de push. **Não partir o push** (handlers `push`,
`notificationclick`, etc. ficam intactos).
**Fazer:**
- Subir `SW_VERSION` para `v1.2.0`.
- Estratégias:
  - `navigate` (HTML): **network-first**, com *fallback* para `index.html` em cache e,
    se falhar, uma página offline mínima em português ("Sem ligação. As mensagens
    cifradas continuam seguras. Tenta de novo.").
  - `/assets/*` (hash do Vite): **cache-first** (imutável).
  - Resto do mesmo domínio estático (ícones, manifest): **stale-while-revalidate**.
- **NUNCA colocar em cache:** qualquer pedido a outro domínio (Supabase, drand, TURN, fontes),
  qualquer `POST`, respostas com `Authorization`, Storage/Realtime/RPC, e tudo o que seja
  mídia cifrada. Regra simples: só `GET` do mesmo `origin`.
- Limpar caches antigos no `activate` (nome com versão).
- Quando houver SW novo, mostrar um aviso discreto "Nova versão disponível — atualizar"
  (evento `updatefound`/`controllerchange`), sem recarregar sem o utilizador querer
  se ele estiver a meio de uma mensagem.
**Aceitação:** em modo avião, a app abre e mostra a UI (ou a página offline); push continua a
funcionar (testar com `send-push` se possível, senão descrever teste manual); nada de
Supabase/drand em Cache Storage (verificar no DevTools > Application). 4 comandos limpos.

---

## T0.4 — Peso e arranque (dados caros)
**Estado:** chunk principal 632 kB (179 kB gzip); fontes via `@import` do Google Fonts
(bloqueia a renderização e envia pedidos a terceiros).
**Fazer:**
1. **Fontes locais:** descarregar JetBrains Mono (400/500/700) e Inter (400/500/600) em
   `woff2`, subset latino, para `public/fonts/`; `@font-face` com `font-display: swap` e
   `<link rel="preload">` só das 2 mais usadas. Remover o `@import` do Google.
2. **Code-splitting:** carregar com `React.lazy` + `Suspense` os ecrãs pesados
   (`ChatScreen`, `DashboardScreen`, `SettingsScreen`, `CreateScreen`, `JoinScreen`,
   `LoginScreen`); manter `HomeScreen` no bundle inicial. Fallback de carregamento já existe
   ("INICIALIZANDO...").
3. `vite.config.ts` → `build.rollupOptions.output.manualChunks` separando `react`,
   `framer-motion` e `@supabase/supabase-js`. `tlock-js` já é *lazy*: manter.
4. Medir antes/depois e colocar a tabela no PR.
**Meta:** JS inicial **≤ 110 kB gzip** (home + vendor mínimo). Se não chegar, explicar o que
sobra e porquê. Zero pedidos a `fonts.googleapis.com`.
**Aceitação:** a app funciona igual (navegação entre todos os ecrãs sem erro); 4 comandos limpos.

---

## T0.5 — README
Criar `README.md` na raiz, em português, curto e honesto:
o que é; ecrãs/funcionalidades; stack; como correr (`.env.example`, `npm i`, `npm run dev`);
**nota HTTPS:** `crypto.subtle` só existe em HTTPS/localhost, por isso testar no telemóvel via
deploy da Vercel ou túnel, **não** por `http://IP-local`; como fazer deploy (Vercel + Supabase,
secrets das Edge Functions: `GROQ_API_KEY`, VAPID); estrutura de pastas;
secção "Modelo de segurança" com **o que está protegido e o que o servidor vê**
(metadados: apelidos, horas, tipo de mensagem). Sem promessas que o código não cumpre.
**Aceitação:** um programador novo consegue correr o projeto só com o README.

---

## T0.6 — Fotografia do esquema real da base de dados
**Problema:** o app usa RPCs e tabelas que não existem em `supabase/migrations/`:
`join_room_secure`, `insert_message_secure`, `verify_participant`, `vote_poll_secure`,
`react_secure`, `insert_eivorak_reply_secure`, tabelas `stories`, `friends`, `story_views`
(e possivelmente mais). Só existem na BD real.
**Quem faz o quê:** o DONO corre as queries de `schema-queries.sql` no SQL Editor do Supabase
(uma de cada vez) e cola os resultados. O Codex **não tem acesso à BD**; não inventes SQL.
**Fazer (com os resultados colados):** guardar em `supabase/schema/`:
`functions.sql`, `policies.sql`, `tables.sql`, `triggers.sql`, `grants.sql`, `README.md`.
Cada ficheiro começa com: `-- SNAPSHOT de referência (data). NÃO é uma migration.`
**NÃO** pôr isto em `supabase/migrations/` (o CLI tentaria aplicá-lo).
**Antes de commitar:** procurar segredos (`eyJ`, `service_role`, `Bearer `, URLs com
chaves, `password`) e substituir por `<REDACTED>`; listar no PR o que foi redigido.
**Aceitação:** snapshot completo; segredos redigidos; no `README.md`, tabela "função → quem
pode executar (anon/authenticated)" e lista de tabelas **sem RLS**, se existirem.

---

## T0.7 — Modelo de ameaças (só análise, sem alterar código)
**Skill:** `security-threat-model`. **Depende de:** T0.1–T0.6.
Gerar `docs/threat-model.md`: ativos, fronteiras de confiança, atacantes (servidor
comprometido, quem adivinha códigos, utilizador malicioso numa sala, XSS, perda do
telemóvel), caminhos de abuso e mitigações, **priorizado**. Citar ficheiros/linhas.
Incluir obrigatoriamente: RPCs executáveis por `anon`, EiVORAK (envia contexto em claro à
Groq), stories, metadados visíveis ao servidor, `secret` no `localStorage`, CORS `*` nas
Edge Functions, ausência de limite de tentativas ao entrar.
**Aceitação:** documento revisto pelo arquiteto. Nenhum ficheiro de `src/` ou `supabase/` alterado.

---

# Fase 1 — Chave fora do servidor (decisão do dono: **só por link/QR**)

**Modelo novo (resumo):**
- `roomCode` (ex.: `ABCD-EFGH`) passa a ser só um **identificador público** da sala. Já não gera a chave.
- `roomSecret`: 16 bytes aleatórios gerados no cliente, em base64url (22 caracteres). **Nunca vai ao servidor.**
- Convite: `https://HOST/?room=ABCD-EFGH#k=<roomSecret>`. O fragmento `#` não é enviado pelo
  browser; ao ler o convite o app guarda o segredo e **remove o fragmento** do URL
  (`history.replaceState`). Adicionar `<meta name="referrer" content="no-referrer">`.
- Chaves via **HKDF-SHA-256** a partir do segredo; subchaves separadas para texto, mídia e prova de entrada.
- Formato de texto cifrado v2: `v2.` + base64(iv‖ciphertext). AAD do AES-GCM: `cl2|roomCode|messageId|type`.
- `joinToken` (derivado, distinto da chave): o servidor guarda só o SHA-256 dele e exige-o ao entrar.
  Quem adivinhar o código não entra na sala nem vê metadados.
- Salas antigas (v1, PBKDF2) continuam a abrir por código, só leitura da cifragem antiga;
  salas novas são sempre v2.
- **Consequência de produto:** quem tem o link lê todo o histórico, e a chave vive só nos
  dispositivos que abriram o convite. Num telemóvel novo é preciso abrir o convite de novo
  (cofre de chaves sincronizado fica para a Fase 2). A UI tem de dizer isto com clareza.

## T1.1 — Biblioteca de cifragem v2 (só `src/lib/`, sem tocar em ecrãs nem na BD)
**Skills:** `security-best-practices`. **Depende de:** nada (pode correr em paralelo a T0.x).
**Fazer:** criar `src/lib/cryptoV2.ts` e `src/lib/roomKeys.ts`; **não remover** nada de
`src/lib/crypto.ts` (v1 fica para salas antigas). Usar só Web Crypto, **sem novas dependências**.

`cryptoV2.ts`:
```ts
export const V2_PREFIX = 'v2.';
export const NO_KEY = '[NO_KEY]';            // v2 sem segredo neste dispositivo
export const DECRYPT_FAILED = '[DECRYPT_FAILED]';
export type MsgType = 'text'|'audio'|'image'|'capsule'|'poll'|'paste'|'media';
export interface Ctx { roomCode: string; messageId: string; type: MsgType }

generateRoomSecret(): string                  // 16 bytes → base64url sem padding (22 chars)
deriveRoomKeys(secret: string, roomCode: string):
  Promise<{ text: CryptoKey; media: CryptoKey; joinToken: string }>
encryptTextV2(plaintext: string, secret: string, ctx: Ctx): Promise<string>
decryptTextV2(ciphertext: string, secret: string, ctx: Ctx): Promise<string>  // lança erro se falhar
encryptBinaryV2(data: ArrayBuffer, secret: string, ctx: Ctx): Promise<ArrayBuffer>
decryptBinaryV2(data: ArrayBuffer, secret: string, ctx: Ctx): Promise<ArrayBuffer>
buildInviteUrl(origin: string, roomCode: string, secret: string): string
parseInviteUrl(url: string): { roomCode: string | null; secret: string | null }
```
Regras de derivação (HKDF-SHA-256, `salt = utf8("cipherline/v2")`, ikm = bytes do segredo;
rejeitar segredos que não decodifiquem para exatamente 16 bytes):
- `text`  : `info = "room:" + roomCode + "|text"`  → AES-GCM 256, **não extraível**
- `media` : `info = "room:" + roomCode + "|media"` → AES-GCM 256, **não extraível**
- `joinToken`: `info = "room:" + roomCode + "|join"` → 32 bytes em base64url
IV aleatório de 12 bytes por operação. Binário v2: `[0x02] ‖ iv ‖ ciphertext`.
`parseInviteUrl`: aceitar só segredos que casem `^[A-Za-z0-9_-]{22}$`; devolver `null` se inválido.

`roomKeys.ts` (registo em memória + `localStorage` com `try/catch`, chave `cipherline_rk2:<roomCode>`):
`saveRoomSecret(code, secret)`, `getRoomSecret(code)`, `forgetRoomSecret(code)`, `forgetAllRoomSecrets()`.
Nada de `console.log` com segredos.

**Testes obrigatórios (`src/lib/cryptoV2.test.ts`):**
1. Roundtrip texto e binário (incluindo Unicode e emoji).
2. Falha com `messageId`, `type` ou `roomCode` diferentes (AAD), e com 1 byte adulterado.
3. Chave `text` não decifra dados `media` e vice-versa.
4. `joinToken` determinístico; muda com o `roomCode`; nunca igual ao segredo.
5. As CryptoKeys são `extractable === false`.
6. `buildInviteUrl`/`parseInviteUrl` roundtrip; rejeita segredo curto, longo e com caracteres inválidos;
   `parseInviteUrl` sem `#k=` devolve `secret: null`.
7. Segredos distintos em 1000 chamadas a `generateRoomSecret()`.
8. Os testes v1 existentes em `crypto.test.ts` continuam a passar sem alteração.
**Aceitação:** os 4 comandos limpos; zero alterações em `src/screens/`, `src/components/` e
`supabase/`; nenhum pacote novo no `package.json`.

## T1.2 — Base de dados  (BLOQUEADA até T0.6 estar feita; spec detalhada pelo arquiteto)
Resumo do que vem: `rooms.crypto_version` (1 = antigo, 2 = novo) e `rooms.join_verifier`;
`join_room_secure` passa a exigir `p_join_token` (comparar com `digest(token,'sha256')`
em salas v2); `insert_message_secure` aceita `p_message_id uuid` gerado no cliente
(para o AAD); enquetes: `poll_data` guarda só `{options:[{id, votes}], allowMultiple}`
**sem textos** (pergunta e opções vão só cifradas); remover/ignorar o código personalizado
de sala. Atenção a `DROP FUNCTION` da assinatura antiga para não criar *overloads*.

## T1.3 — Ligação no cliente  (BLOQUEADA por T1.1 e T1.2)
Criar canal gera segredo + convite (QR leve carregado sob demanda ≤ 15 kB gzip, e
`navigator.share` com cópia como alternativa); entrar por link; `CapsuleComposer` passa a
`timelock(cifra v2)`; Dashboard usa o segredo guardado e mostra "🔒 abre o convite neste
dispositivo" quando faltar; `forgetAllRoomSecrets()` no pânico e no sign-out; CSP rígida.

## T1.4 — Stories: honestidade primeiro
Hoje a chave dos stories é `profile.id` (UUID público): é ofuscação. Não prometer
cifragem que não existe: ajustar texto/etiquetas e abrir tarefa própria na Fase 2
("stories E2E com chave por story partilhada com amigos").

---

# Fases seguintes (sem spec ainda)
- **T2** Etiqueta de privacidade por sala · **T3** EiVORAK com consentimento
- **T4** Sistema de design (tokens + componentes) e redesenho dos ecrãs
- **Fase 2:** cofre de chaves sincronizado, rotação/revogação de convites, stories E2E,
  limite de tentativas ao entrar, assinatura por membro (impede o servidor de reatribuir remetentes).
