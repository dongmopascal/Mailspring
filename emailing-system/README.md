# Emailing System — cœur de la pipeline d'envoi

Module Node.js autonome qui envoie des emails via un ou plusieurs serveurs
SMTP, avec queue persistante, retry/backoff, failover automatique, circuit
breaker et rate limiting par serveur. C'est la fondation sur laquelle
viennent se greffer les features suivantes (tracking d'ouverture/clics,
bounce handling, unsubscribe, A/B testing, etc.).

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

// Envoi en masse (newsletter)
system.sendBulk(
  [{ to: 'a@example.com', variables: { name: 'A' } }, { to: 'b@example.com', variables: { name: 'B' } }],
  { subject: 'Newsletter de juillet', template: 'welcome', priority: PRIORITY.NORMAL }
);

system.start();               // démarre le worker qui vide la queue
console.log(system.stats());  // { pending, sending, sent, dead }
console.log(system.smtpStatus());
```

## Configuration multi-serveurs (failover)

Dans `.env`, au lieu de `SMTP_HOST`/`SMTP_USER`/..., définis `SMTP_SERVERS`
avec un tableau JSON. Le premier serveur en bonne santé et sous son quota
est utilisé ; si un serveur échoue plusieurs fois de suite, il est mis en
pause automatiquement et le trafic bascule sur le suivant. Voir
`.env.example` pour la syntaxe exacte.

## Tester sans serveur SMTP réel

```bash
npm run test:smoke
```

Ce test simule un serveur SMTP en panne et un serveur de secours (via le
`jsonTransport` intégré à nodemailer, qui ne se connecte à rien) pour
prouver que la queue, les retries, le circuit breaker et le failover
fonctionnent, sans dépendance réseau.

## Architecture

```
src/
  config.js     charge la config (env vars ou overrides programmatiques)
  db.js         schéma SQLite (table `emails`) via node:sqlite
  queue.js      enqueue / claim / markSent / markFailed / backoff
  smtpPool.js   multi-transport nodemailer, failover, circuit breaker, rate limit
  worker.js     boucle qui vide la queue et appelle le pool SMTP
  templates.js  rendu Handlebars avec cache
  index.js      API publique: sendEmail / sendTemplate / sendBulk / start / stop / stats
```

## Prochaines étapes possibles

- Tracking d'ouverture (pixel) et de clics (réécriture de liens)
- Bounce handling (webhook du fournisseur ou parsing IMAP des NDR)
- Unsubscribe en un clic + header `List-Unsubscribe`
- API HTTP + webhooks (`delivered`, `opened`, `clicked`, `bounced`)
- Dashboard de campagne (taux d'ouverture, clics, désinscriptions)
