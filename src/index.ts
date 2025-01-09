#!/usr/bin/env node

import { program } from 'commander';
import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

// Load environment variables
config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface ManifestFile {
  path: string;
  description: string;
  status: 'pending' | 'generated' | 'deleted';
}

interface Manifest {
  files: ManifestFile[];
}

interface AddCommand {
  add: {
    path: string;
    description: string;
  };
}

interface UpdateCommand {
  update: {
    path: string;
    content: string;
    why: string;
  };
}

interface RemoveCommand {
  remove: {
    path: string;
  };
}

interface FinishCommand {
  finish: string;
}

type Command = AddCommand | UpdateCommand | RemoveCommand | FinishCommand;

class SourceGenerator {
  private manifest: Manifest = { files: [] };
  private specContent: any;
  private manifestPath = './autosrc.json';

  constructor(private specPath: string) {}

  async init() {
    try {
      // Read and parse the spec file
      const specRaw = await fs.readFile(this.specPath, 'utf-8');
      this.specContent = JSON.parse(specRaw);

      // Create or load the manifest
      try {
        const manifestRaw = await fs.readFile(this.manifestPath, 'utf-8');
        this.manifest = JSON.parse(manifestRaw);
      } catch {
        await this.generateInitialManifest();
      }
    } catch (error) {
      console.error('Failed to initialize:', error);
      process.exit(1);
    }
  }

  private async generateInitialManifest() {
    console.log(`Generating initial manifest`);
    const message = `Given this project specification:
${JSON.stringify(this.specContent, null, 2)}

Please predict the project structure and create a manifest of all files that will need to be generated.
The manifest should be a JSON array of objects with this format:
{
  "path": "relative path to the file",
  "description": "description of the file's purpose",
  "status": "pending"
}

Respond with only the JSON array.`;

    const response = await anthropic.messages.create({
      model: 'claude-3-opus-20240229',
      max_tokens: 4096,
      messages: [{ role: 'user', content: message }],
    });

    try {
      const content = response.content[0].text;
      const files = JSON.parse(content);
      this.manifest = { files };
      await this.saveManifest();
    } catch (error) {
      console.error('Failed to parse initial manifest:', error);
      process.exit(1);
    }
  }

  private async saveManifest() {
    await fs.writeFile(
      this.manifestPath,
      JSON.stringify(this.manifest, null, 2)
    );
  }

  private async processCommands(commands: Command[]) {
    console.log(`Received ${commands.length} commands from Claude`);
    for (const command of commands) {
      if ('add' in command) {
        const { path, description } = command.add;
        console.log(`ADD ${path}`);
        this.manifest.files.push({
          path,
          description,
          status: 'pending',
        });
        await this.saveManifest();
      } else if ('update' in command) {
        const { path: filePath, content } = command.update;
        console.log(`UPDATE ${filePath}`);
        if(typeof(content) !== 'string') {
          console.error(`Claude returned unexpected file content: ${JSON.stringify(command.update)}`)
        }
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, content);
        
        const file = this.manifest.files.find(f => f.path === filePath);
        if (file) {
          file.status = 'generated';
          await this.saveManifest();
        }
      } else if ('remove' in command) {
        const { path: filePath } = command.remove;
        console.log(`REMOVE ${filePath}`);
        await fs.unlink(filePath);
        
        const file = this.manifest.files.find(f => f.path === filePath);
        if (file) {
          file.status = 'deleted';
          await this.saveManifest();
        }
      } else if ('finish' in command) {
        console.log('\nGeneration complete!');
        console.log(command.finish);
        return true;
      }
    }
    return false;
  }

  async generate() {
    let finished = false;

    while (!finished) {
      const message = `Project specification:
${JSON.stringify(this.specContent, null, 2)}

Current manifest:
${JSON.stringify(this.manifest, null, 2)}

Please continue generating source files, skipping any that are already marked as generated.
Respond with a JSON array of command objects with one of these formats:

ADD: { "add": { "path": "file path", "description": "file description" } }
UPDATE: { "update": { "path": "file path", "content": "file contents", "why": "reason for update" } }
REMOVE: { "remove": { "path": "file path" } }
FINISH: { "finish": "final report" }

Generate only files that haven't been generated yet. Include file contents in UPDATE commands.
Respond with only the JSON array of commands.`;

      try {
        const response = await anthropic.messages.create({
          model: 'claude-3-opus-20240229',
          max_tokens: 4096,
          messages: [{ role: 'user', content: message }],
        });

        const content = response.content[0].text;
        console.log(`RESPONSE: ${content}`);
        const commands: Command[] = JSON.parse(content);
        finished = await this.processCommands(commands);
      } catch (error) {
        console.error('Error during generation:', error);
        process.exit(1);
      }
    }
  }
}

// CLI setup
program
  .name('claude-source-generator')
  .description('Generate project source files using Claude')
  .argument('<spec>', 'path to the project specification JSON file')
  .action(async (spec: string) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('Error: ANTHROPIC_API_KEY environment variable is required');
      process.exit(1);
    }

    const generator = new SourceGenerator(spec);
    await generator.init();
    await generator.generate();
  });

program.parse();