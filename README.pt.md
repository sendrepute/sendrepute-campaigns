[English](README.md) · [العربية](README.ar.md) · [Français](README.fr.md) · [Русский](README.ru.md) · [Українська](README.uk.md) · [हिन्दी](README.hi.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [简体中文](README.zh.md) · [Tiếng Việt](README.vi.md)

# SendRepute Campaigns

Públicos, campanhas, modelos, automações e entrega auto-hospedados a partir do seu próprio
servidor. Este repositório distribui o **runtime compilado**, não o monorepo completo
do código-fonte.

![Prévia no desktop do SendRepute Campaigns](docs/assets/campaigns-github-desktop.jpg)

Experimente a [demonstração interativa](https://www.sendrepute.com/campaigns/?demo=true)
(sem mensagens reais, construtores hospedados ou resultados pagos).

<a id="quickstart-fresh-ubuntu-24042604"></a>

## Início rápido: Ubuntu 24.04/26.04 limpo

Em um **servidor novo sem uma instalação existente do Campaigns**, execute:

```sh
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/sendrepute/sendrepute-campaigns.git
cd sendrepute-campaigns
./setup.sh
```

O setup pergunta qual modo de acesso usar e reaproveita um Docker/Compose já funcional; em um
servidor Ubuntu recém-instalado compatível e sem Docker, ele solicita consentimento para instalar
os pacotes do Ubuntu. Ele não remove o Docker via Snap nem ignora o AppArmor. Não faça um
clone sobre uma instalação existente; consulte [Atualização](#update).

**CAMPAIGNS READY FOR OWNER SETUP** significa que o aplicativo está saudável dentro do seu
contêiner, não que a configuração do proprietário esteja concluída ou que o HTTPS público tenha sido verificado.
Para o HTTPS, primeiro verifique a página de instalação exibida a partir de outra rede:
ela deve ter um certificado válido e confiável, sem avisos no navegador. Se o
certificado estiver pendente ou inválido, **não** insira nenhum segredo.

Para um novo proprietário, o token de uso único é **obrigatório**, não opcional. Quando o seu
acesso escolhido estiver pronto, execute isto na VPS **a partir do diretório do projeto**:

```sh
sudo docker compose exec campaigns cat /var/lib/sendrepute-campaigns/installer-token
```

Omita `sudo` se a sua conta Docker não exigir. Copie a saída do comando
e cole-a no campo **Setup token** na página de instalação exibida.
Preencha os detalhes do proprietário e a respectiva Public URL terminada em `/campaigns/`,
em seguida, conclua a ativação do SendRepute e a configuração do proprietário no assistente. O setup **não**
imprime o token automaticamente. Nunca o coloque em uma URL ou o compartilhe; mantenha
o token, `.env` e os logs privados. Um workspace já instalado não
precisa de outro token de setup.

<a id="choose-access"></a>

## Escolha o acesso

- **Domínio HTTPS (recomendado):** o setup inicia o proxy Caddy incluído.
  Insira um subdomínio que você controla, por exemplo `campaigns.example.com` (substitua
  pelo seu), **sem protocolo, porta ou caminho**. Aponte o registro DNS
  `A` desse hostname para este servidor, libere TCP 80/443 e verifique
  o certificado confiável externamente. Utilize `AAAA` apenas com IPv6 funcional.
- **Túnel local / SSH:** vincula o app ao loopback da VPS. Abra-o através de um
  túnel SSH confiável do seu computador; o `localhost` do seu notebook não é
  a VPS.
- **IP público + HTTP:** exige consentimento explícito para acesso não criptografado na porta 8080.
  Senhas, tokens e sessões podem ser interceptados; **não indicado para implantação
  segura em produção**.

Consulte o [guia de comandos de setup](docs/install.md#guided-setup-command-cookbook)
para comandos exatos, opções, tunelamento SSH local, diagnósticos e avisos.

<a id="moving-from-http-to-https"></a>

## Migrando de HTTP para HTTPS

Faça backup primeiro. Aponte **seu hostname real** para a VPS, libere/abra TCP 80/443
e confirme se o DNS funciona. Na VPS, no diretório **existente** do projeto:

```sh
./setup.sh --mode https --host campaigns.sendrepute.com
```

Substitua `campaigns.sendrepute.com` pelo seu hostname (`campaign` e
`campaigns` são nomes DNS diferentes). Confirme a mudança de exposição quando solicitado;
o setup inicia o Caddy, mas não reescreve a Public URL salva do workspace
instalado. Após verificar o HTTPS externamente, altere essa URL em **Workspace
Settings** para `https://YOUR_HOSTNAME/campaigns/`. Se usar Cloudflare, utilize
**Full (strict)**, nunca Flexible. Consulte os
[passos de migração](docs/install.md#migrate-an-installed-public-ip-http-workspace-to-https)
antes de alterar uma instalação em produção.

<a id="download-v0141"></a>

## Download da v0.1.41

Os administradores podem verificar a disponibilidade de releases estáveis do GitHub em Workspace Settings. Os anexos oficiais de arquivos compactados da Release versionada e os checksums SHA-256 têm preferência. Se esses anexos esperados estiverem ausentes, o verificador pode, alternativamente, resolver a mesma tag de release estável no repositório oficial para seu commit imutável e validar o manifesto de checksums vinculado `downloads/` daquele commit. Os links de download do repositório são fixados nesse commit, não em uma tag ou branch móvel. Anexos esperados inválidos ou duplicados nunca permitem esse fallback. Settings exibe um aviso de atualização, links de download/checksum e o comando de atualização manual documentado do servidor para um clone Git existente; ele nunca instala, extrai ou executa um download. Faça backup da instalação primeiro, em seguida, siga o procedimento de upgrade e reinício para o operador. Instalações baseadas em arquivos compactados devem seguir as instruções separadas de upgrade de arquivo e verificar os bytes baixados contra os checksums. Falhas no GitHub, metadados de publicação ausentes ou malformados e versões instaladas desconhecidas são reportados como indisponíveis, nunca como atualizados. Novos arquivos de release incluem os metadados da versão instalada; instalações antigas sem esses metadados não podem afirmar que estão atuais. A publicação da release e dos checksums são etapas separadas do operador, não realizadas pelo aplicativo.

Prefere um arquivo versionado? Baixe o [ZIP](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.41/downloads/sendrepute-campaigns-0.1.41.zip)
ou [tar.gz](https://github.com/sendrepute/sendrepute-campaigns/raw/refs/tags/v0.1.41/downloads/sendrepute-campaigns-0.1.41.tar.gz),
verifique os [checksums SHA-256](https://github.com/sendrepute/sendrepute-campaigns/blob/v0.1.41/downloads/sendrepute-campaigns-0.1.41-SHA256SUMS),
extraia e execute `./setup.sh` no local. Esses são downloads do repositório, **não**
anexos binários de GitHub Release; **Code → Download ZIP** é um
snapshot diferente. Consulte as [notas de release da v0.1.41](https://github.com/sendrepute/sendrepute-campaigns/releases/tag/v0.1.41).

<a id="additional-tracking-hostnames"></a>

## Hostnames de rastreamento adicionais

Com a instalação HTTPS/Caddy inclusa já em execução, abra **Domains**,
crie um desafio de hostname, adicione seu registro A/AAAA apontando para este servidor e
o registro TXT de propriedade exato exibido, em seguida, clique em **Check DNS and verify**.
O Campaigns adiciona automaticamente o hostname verificado ao mesmo proxy gerenciado
e reutiliza o certificado primário quando seu SAN cobre aquele hostname, caso contrário,
solicita um certificado automático. Repita para múltiplos hostnames; não são necessários comandos
shell por domínio ou edições de proxy, e as configurações do hostname e
certificado da instalação primária permanecem inalteradas. Escolha o hostname verificado
desejado de forma independente no menu suspenso **Tracking domain** de cada campanha.

A aprovação do DNS, a configuração carregada do proxy e o HTTPS público funcional são mostrados
separadamente. Carregar uma configuração não prova a emissão do ACME ou a
acessibilidade pública. Nomes cobertos pela Origin CA exigem proxy do Cloudflare e não
são confiáveis diretamente pelos navegadores. O DNS e as portas 80/443 devem alcançar o proxy existente; o Cloudflare
deve permitir ACME e permanecer em **Full (strict)**. Proxies/túneis externos requerem
configuração do operador. Se o proxy gerenciado não estiver em execução ou o hostname
primário estiver ausente, as adições permanecem na fila até que esse problema
no nível da instalação seja resolvido. Nenhum fallback inseguro de SSL é realizado.

Rotas aprovadas anteriormente são retidas quando um domínio selecionável é excluído
ou seu desafio é rotacionado, para que links entregues não sejam revogados silenciosamente.
Mantenha o DNS e a renovação de certificados deles disponíveis. Preserve o ledger de
aprovação do PostgreSQL e os volumes do HTTPS/Caddy durante upgrades/backups. Instalações com certificado
primário manual podem interromper brevemente as conexões durante uma
atualização/reinício controlado focado apenas no Caddy. Consulte o `SMTP-TRACKING.md` empacotado
para definições de status, retenção de links históricos e limites de falhas/tentativas.

<a id="update"></a>

## Atualização

Faça backup primeiro; consulte [Backup](#back-up).
Na VPS, **dentro do seu clone Git existente** (não um clone novo), inspecione
as alterações locais e, em seguida, execute:

```sh
git status --short
git pull --ff-only && ./setup.sh --mode resume
```

`resume` preserva o modo de acesso existente, incluindo HTTPS. Se o pull recusar,
reconcilie as edições em vez de forçar um reset (force-reset). Preserve `.env`, o mesmo projeto Compose,
os volumes do PostgreSQL e do aplicativo, e a chave de criptografia. Nunca execute
`docker compose down -v` contra dados reais. Para upgrades de arquivos compactados, use as
[instruções de upgrade](docs/operations.md#upgrade), não um clone novo sobre a
instalação.

<a id="back-up"></a>

## Backup

Preserve o banco de dados PostgreSQL completo, os dados da aplicação/chave de criptografia,
o arquivo privado `.env` e o estado do HTTPS/Caddy. Siga os
[comandos completos de backup do Docker](docs/operations.md#docker-infrastructure-backup),
em seguida, mantenha cópias criptografadas e com acesso controlado fora do host. Uma exportação JSON no app
não é um backup da infraestrutura e omite o ledger retido de aprovação do HTTPS,
incluindo hostnames aprovados cujas linhas de domínio selecionáveis foram excluídas.

Para backups off-host criptografados **agendados por adesão (opt-in)**, use os exemplos inclusos
do `backup.sh`, `backup.conf.example` e systemd. Nada é agendado
ou ativado pelo setup. Instale `age` e configure um diretório montado off-host existente
ou um destino restrito no SFTP. Deixe ambas as configurações do age em branco:
o primeiro backup interativo cria seu arquivo de recuperação automaticamente e pede
que você salve uma cópia segura separada antes de prosseguir. Backups subsequentes a reutilizam;
não há comandos de geração de chaves ou valores de chaves públicas para copiar na configuração.
O host mantém uma cópia protegida para verificar cada backup; nunca armazene sua
cópia de recuperação independente junto aos arquivos de backup criptografados.
Consulte sobre [backups automatizados](docs/operations.md#opt-in-encrypted-scheduled-backups)
para pré-requisitos, ativação segura, verificação e recuperação. A partir do diretório
instalado, `./backup.sh status` exibe a última tentativa, o último êxito e o arquivo salvo;
ele permanece legível se a identidade age ou as ferramentas de backup não estiverem disponíveis, desde que
a configuração privada do operador e o arquivo spool/status local estejam intactos.
`./backup.sh verify /private/path/archive.tar.age` verifica a decriptação, o manifesto e
o formato do PostgreSQL sem restaurar os dados.

<a id="restore"></a>

## Restauração

Restaure apenas a partir de um backup verificado e correspondente do PostgreSQL **e** do volume de dados;
a exportação JSON no app omite tarefas de entrega, eventos de auditoria e outros estados
do runtime. A restauração pode sobrescrever dados mais recentes ou retomar emails na fila. Siga os
[passos de restauração isolada](docs/operations.md#restore-to-an-empty-isolated-installation)
antes de qualquer transição (cutover) para produção.

<a id="more-information"></a>

## Mais informações

- [Comandos de instalação e setup](docs/install.md) — todas as flags, HTTPS/HTTP,
  caminhos manuais do Docker ou Node.js, token e solução de problemas.
- [Operações, backup e restauração](docs/operations.md) — upgrades e recuperação.
- [Segurança e entregabilidade](docs/security-and-deliverability.md) — SMTP,
  SPF/DKIM/DMARC, consentimento e verificações de produção.
- [Contrato do servidor autônomo (standalone)](docs/server-contract.md) — detalhes da integração.

A ativação valida uma chave de API do SendRepute emitida separadamente; **nenhum depósito é
necessário para a ativação**, e o gerenciamento local é gratuito. Os recursos opcionais hospedados de IA
e classificação exigem direito ou crédito próprio e consentimento de preço
explícito; a IA de demonstração não gera resultados pagos. A entrega ocorre a partir do **seu
servidor para o seu relay/provedor SMTP configurado**, não por meio de um proxy SMTP
central do SendRepute.

<a id="release-boundary"></a>

## Escopo da release

A release inclui o navegador compilado, o servidor, a ponte de entrega e de API do cliente,
o SDK público do cliente, as migrações e a documentação. Ela exclui o
site principal e o scanner do SendRepute, o conteúdo do banco de dados, os segredos, os source maps, os testes
e a cadeia de ferramentas de desenvolvimento. Os termos de licença de componentes e terceiros ainda
se aplicam; o self-hosting não concede licença de serviço hospedado ou garantia de
alocação em caixa de entrada.
