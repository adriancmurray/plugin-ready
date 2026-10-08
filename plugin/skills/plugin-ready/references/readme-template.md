# README template

Put README.md inside the plugin folder; the directory reads only that folder. Delete lines that do not apply, and do not leave a line saying "none" for something the plugin does.

```markdown
# <plugin-name>

<One paragraph: what it does and who it is for.>

Unofficial community plugin; not affiliated with Anthropic.   <- if true

## What's inside

- **<component>** (`<hook event or file>`): <what it does>.

## What <plugin-name> changes and touches

- **`<hook event>`** (<what passes through it>): <exactly what it changes or refuses, and when>. <Default: on or off, and the setting that controls it>.
- **Commands it runs**: <none | which, when, and whether Claude asks permission first>.
- **Network**: <none | hosts contacted, what is sent>.
- **Storage**: <what is written, and where>.
- **Reads**: <files or session data read, and why>.
- **Credentials**: <none read | which, why, and that they are not sent>. No environment variables, keychain or files under ~/.claude are read.   <- only if true

## Requirements

## Install

## Settings

| Key | Default | What it does |

## Limitations

## License
```

Rules:
- At least 40 words outside code blocks.
- Name every hook event the plugin registers, with what it changes.
- Every claim must match the code. The portal scan compares what the code does with what the README says.
