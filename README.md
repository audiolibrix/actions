# GitHub Actions

Sdílené composite actions pro GitHub workflow. Repo je veřejné, aby šly
volat z jakéhokoli repozitáře. Nepatří sem nic tajného ani specifického
pro konkrétní projekt — webhooky, tokeny a podobné hodnoty přicházejí jako
inputy ze secretů volajícího repa.

| action | k čemu |
|---|---|
| [`notify-slack`](notify-slack/action.yml) | začátek a výsledek běhu workflow do Slacku |

## Verze

Volá se přes hlavní tag, třeba `@v1`. Zpětně kompatibilní změna posune `v1`
na nový commit, rozbíjející dostane `v2`.
