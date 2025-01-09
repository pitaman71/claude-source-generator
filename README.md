# claude-source-generator

A utility that uses Claude to generate source files for an entire project based on a specification file.

## Installation

```bash
npm install -g claude-source-generator
```

## Prerequisites

You'll need an Anthropic API key to use this tool. Set it in your environment:

```bash
export ANTHROPIC_API_KEY=your-api-key
```

Or create a `.env` file in your project directory:

```
ANTHROPIC_API_KEY=your-api-key
```

## Usage

```bash
claude-source-generator spec.json
```

Where `spec.json` is your project specification file.

## Project Specification Format

The specification file should be a JSON file that describes your project requirements. The format is flexible and will be interpreted by Claude to generate appropriate source files.

Example spec.json:
```json
{
  "projectName": "my-awesome-app",
  "description": "A web application that does amazing things",
  "technologies": {
    "frontend": "React",
    "backend": "Node.js",
    "database": "PostgreSQL"
  },
  "features": [
    "User authentication",
    "Dashboard",
    "API integration"
  ]
}
```

## How it Works

1. The tool reads your project specification
2. Creates an initial manifest of all files that need to be generated
3. Iteratively generates each source file using Claude
4. Maintains a manifest of generated files in `autosrc.json`

## Manifest Format

The tool maintains a manifest file (`autosrc.json`) that tracks the status of all files:

```json
{
  "files": [
    {
      "path": "src/index.ts",
      "description": "Main entry point",
      "status": "generated"
    }
  ]
}
```

Status can be one of:
- `pending`: File is planned but not yet generated
- `generated`: File has been successfully generated
- `deleted`: File was previously generated but has been removed

## License

MIT