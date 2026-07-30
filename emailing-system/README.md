# Emailing System — cœur de la pipeline d'envoi

Module Node.js autonome qui envoie des emails via un ou plusieurs serveurs
SMTP, avec queue persistante, retry/backoff, failover automatique, circuit
breaker, rate limiting par serveur, tracking d'ouverture/clics, bounce
handling automatique, unsubscribe en un clic et un dashboard de campagnes.
C'est la fondation sur laquelle viennent se greffer d'autres features
(A/B testing, API + webhooks, etc.).

## Pourquoi ce module et pas juste `nodemailer.sendMail()`

`nodemailer` seul envoie un email et s'arrête là. Ce module ajoute tout ce
qui est nécessaire pour un vrai système d'emailing en prod :

- **Queue persistante (SQLite)** : les emails survivent à un crash/redémarrage,
  rien n'est perdu en mémoire.
- **Priorités** : un email transactionnel (reset de mot de passe) passe
  toujours avant une campagne bulk.
- **Retry avec backoff exponentiel** : un échec temporaire (timeout réseau)
  est retenté automatiquement, sans spammer le serveur SMTP.
- **Multi-SMTP avec failover** : si le serveur principal tombe, bascule
  automatiquement sur un serveur de secours.
- **Circuit breaker par serveur** : après N échecs consécutifs, un serveur
  est mis en pause (cooldown) au lieu d'être martelé de tentatives vouées à
  l'échec.
- **Rate limiting par serveur** : respecte les quotas d'envoi (ex: 60/min)
  pour ne pas se faire blacklister par ton fournisseur SMTP.

## Installation

```bash
cd emailing-system
npm install
cp .env.example .env   # puis renseigne tes identifiants SMTP
```

## Utilisation

```js
import { createEmailingSystem, PRIORITY } from './src/index.js';

const system = createEmailingSystem(); // lit la config depuis .env

// Email transactionnel (haute priorité)
system.sendEmail({
  to: 'user@example.com',
  subject: 'Réinitialisation de mot de passe',
  html: '<p>Cliquez ici pour réinitialiser...</p>',
  priority: PRIORITY.HIGH,
});

// Email depuis un template Handlebars (templates/welcome.hbs)
system.sendTemplate({
  to: 'user@example.com',
  subject: 'Bienvenue !',
  template: 'welcome',
  variables: { name: 'Alice', email: 'user@example.com' },
});

// Envoi en masse (newsletter), groupe automatiquement sous une campagne
system.sendBulk(
  [{ to: 'a@example.com', variables: { name: 'A' } }, { to: 'b@example.com', variables: { name: 'B' } }],
  { subject: 'Newsletter de juillet', template: 'welcome', priority: PRIORITY.NORMAL, campaignName: 'Newsletter Juillet' }
);

await system.start();          // démarre le worker (et le serveur de tracking si activé)
console.log(system.stats());   // { pending, sending, sent, dead }
console.log(system.smtpStatus());
```

## Tracking d'ouverture et de clics

Active `TRACKING_ENABLED=true` dans `.env` (avec `TRACKING_BASE_URL` pointant
vers une URL **publiquement accessible**, sinon les emails ouverts depuis une
vraie boîte mail ne pourront pas contacter ton serveur). Dès qu'un email est
envoyé avec du HTML :

- un pixel invisible est ajouté (`<img src=".../t/o/<id>.png">`) → une requête
  dessus marque l'email comme ouvert.
- chaque lien `<a href="...">` est réécrit pour passer par
  `.../t/c/<id>?u=...` → le clic est enregistré puis l'utilisateur est
  redirigé (302) vers l'URL d'origine.

```js
console.log(system.trackingStats());
// { totalSent, totalOpened, totalClicks, openRate, clickRate }
```

Le serveur de tracking tourne dans le même process, démarré par
`system.start()`. Pour un vrai déploiement, mets-le derrière ton reverse
proxy / domaine public.

## Bounce handling (rejets définitifs)

Quand le serveur SMTP répond avec un code **5xx** (ex: `550 no such user`),
c'est définitif : réessayer ne servira jamais à rien. Le worker détecte ces
rejets (`error.responseCode` entre 500 et 599, exposé par nodemailer) et :

- marque l'email `dead` immédiatement, sans consommer le budget de retry ;
- ajoute automatiquement le destinataire à une **liste de suppression**
  (`suppressions` en base).

Toute tentative d'envoi ultérieure vers une adresse suppressed est bloquée
**avant** même de toucher la queue ou le SMTP :

```js
system.sendEmail({ to: 'adresse-qui-a-bounce@example.com', ... }); // renvoie null, rien n'est envoye
system.isSuppressed('adresse-qui-a-bounce@example.com'); // true
```

Un rejet **4xx** (boîte pleine, greylisting...) reste traité comme transitoire
et suit le retry/backoff normal.

## Unsubscribe en un clic

Active `UNSUBSCRIBE_ENABLED=true` dans `.env`. Chaque email envoyé reçoit
alors les headers `List-Unsubscribe` et `List-Unsubscribe-Post` (exigés par
Gmail/Yahoo depuis 2024 pour les envois en masse), pointant vers le même
serveur HTTP que le tracking. Un clic (ou le one-click POST automatique
déclenché par le client mail) ajoute le destinataire à la même liste de
suppression que le bounce handling — les deux mécanismes protègent contre
le même risque : continuer à écrire à quelqu'un qui ne veut plus recevoir
tes emails.

## Campagnes et dashboard

`sendBulk(..., { campaignName: 'Newsletter Juillet' })` crée automatiquement
une campagne et y rattache tous les emails envoyés (ou passe un `campaignId`
existant pour regrouper plusieurs envois sous la même campagne). Chaque
email — y compris ceux envoyés via `sendEmail`/`sendTemplate` avec un
`campaignId` explicite — remonte alors dans les stats de sa campagne :
envoyés, ouverts, clics, bounces, désinscrits.

```js
const stats = system.campaignStats(campaignId);
// { total, sent, bounced, opened, clicks, unsubscribed, openRate, clickRate, bounceRate }
console.log(system.listCampaigns()); // toutes les campagnes + leurs stats
```

Active `DASHBOARD_ENABLED=true` pour exposer une page **`/dashboard`** (sur
le même serveur HTTP que le tracking/unsubscribe) qui liste toutes les
campagnes avec ces métriques dans un tableau — pratique pour un coup d'oeil
rapide sans écrire de requête SQL.

## Configuration multi-serveurs (failover)

Dans `.env`, au lieu de `SMTP_HOST`/`SMTP_USER`/..., définis `SMTP_SERVERS`
avec un tableau JSON. Le premier serveur en bonne santé et sous son quota
est utilisé ; si un serveur échoue plusieurs fois de suite, il est mis en
pause automatiquement et le trafic bascule sur le suivant. Voir
`.env.example` pour la syntaxe exacte.

## Tester sans serveur SMTP réel

```bash
npm test                  # tous les tests
npm run test:smoke        # queue / retry / failover / circuit breaker
npm run test:tracking     # pixel d'ouverture + tracking de clics
npm run test:bounce       # rejet 5xx -> dead immediat + suppression
npm run test:unsubscribe  # header List-Unsubscribe + one-click
npm run test:dashboard    # campagnes + stats agregees + page /dashboard
```

Ces tests simulent les serveurs SMTP (`jsonTransport` intégré à nodemailer,
ou un transport custom qui échoue/bounce volontairement) pour prouver que
la queue, les retries, le circuit breaker, le failover, le tracking, le
bounce handling, l'unsubscribe et les campagnes fonctionnent, sans
dépendance réseau externe.

## Architecture

```
src/
  config.js     charge la config (env vars ou overrides programmatiques)
  db.js         schéma SQLite (table `emails`) via node:sqlite
  queue.js      enqueue / claim / markSent / markFailed / backoff
  smtpPool.js   multi-transport nodemailer, failover, circuit breaker, rate limit
  worker.js     boucle qui vide la queue et appelle le pool SMTP
  templates.js        rendu Handlebars avec cache
  tracking.js         injection du pixel d'ouverture + réécriture des liens trackés
  trackingStore.js    lecture/écriture des opens/clics en base
  trackingServer.js   serveur HTTP: pixel, redirection de clics, unsubscribe
  bounceClassifier.js classe une erreur SMTP en permanente (5xx) ou transitoire
  suppressionList.js  liste des adresses a ne plus jamais contacter (bounce/unsubscribe)
  campaigns.js        regroupement des envois en campagnes + stats agregees
  dashboard.js        rendu HTML de la page /dashboard
  index.js            API publique: sendEmail / sendTemplate / sendBulk / start / stop /
                       stats / trackingStats / isSuppressed / suppressionCount /
                       createCampaign / listCampaigns / campaignStats
```

## Prochaines étapes possibles

- API HTTP + webhooks (`delivered`, `opened`, `clicked`, `bounced`, `unsubscribed`)
- A/B testing (objet, contenu, expéditeur)
- Parsing IMAP des NDR pour les fournisseurs sans webhook de bounce
