# Autohost Archive

This is the source code for the now defunct Autohost bot for TETR.IO. Feel free to browse it for some inspiration, or as the basis for your own bot (assuming you have permission to do so).

The level of jank here is unprecedented. I do a lot of things wrong, there's a whole load of unfinished functionality, and you should seriously consider other options before diving into this hellhole.

## What's here?

The backend source code for Autohost v5.5.2, a slightly modified version of the final live build before the bot was shut down.

## What's not here?

The web frontend, and some external assets.

## Configuration

Depending on your setup, you may need to configure some or all of the following environment variables.

```shell
TOKEN= # TETR.IO bot token (MUST be a bot)

JWT_KEY= # Randomly generated key for JWT signing
PUSH_PUBLIC_KEY= # VAPID public key
PUSH_PRIVATE_KEY= # VAPID private key

MONGO_URI= # MongoDB URI, configured automatically with docker compose
REDIS_URI= # Redis URI, configured automatically with docker compose

API_PORT= # Port the API should listen on, configured automatically with docker compose

DISCORD_TOKEN= # Discord bot token
DISCORD_CLIENT_ID= # Discord client ID for oauth
DISCORD_CLIENT_SECRET= # Discord client secret for oauth
DISCORD_REDIRECT_URI= # Discord redirect URI for oauth

WEB_ORIGIN= # Origin from which the web frontend is being served

PERSIST_ROOMS_DISABLED=1 # Misnomer, this actually determines whether or not persist lobbies are private
```
