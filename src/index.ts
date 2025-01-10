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
    process.stdout.write(`Generating initial manifest\n`);
    const message = `Given this project specification:
${JSON.stringify(this.specContent, null, 2)}

Make a plan of all of the changes you will need to perform in order to create  a completely correct project according to the specification.
Your plan should be a list of instructions:

ADD : if you need to a new file to the project, then queue an ADD command with format: { add: { path: 'path of file to be added', description: 'description of the file to be added' } }
- If in order to comlpete the project, you need to generate or update a file already listed as generated in the manifest, then queue an UPDATE command with format: { update: { path: 'path of file to be added', content: 'contents of generated file', why: 'reason why file is being updated' } }
- If in order to comlpete the project, you need to remove a file already in the manifest, then queue a REMOVE command with format: { remove: { path: 'path of file to be added' } }
- If in order to comlpete the project, you determine there are absolutely no more files to be added, updated, or removed, then queue a FINISH command with format: { finish: 'final report once no more files need to be added, updated, or removed' }

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
    process.stdout.write(`Received ${commands.length} commands from Claude\n`);
    for (const command of commands) {
      if ('add' in command) {
        const { path, description } = command.add;
        process.stdout.write(`ADD ${path}\n`);
        this.manifest.files.push({
          path,
          description,
          status: 'pending',
        });
        await this.saveManifest();
      } else if ('update' in command) {
        const { path: filePath, content } = command.update;
        process.stdout.write(`UPDATE ${filePath}\n`);
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
        process.stdout.write(`REMOVE ${filePath}\n`);
        await fs.unlink(filePath);
        
        const file = this.manifest.files.find(f => f.path === filePath);
        if (file) {
          file.status = 'deleted';
          await this.saveManifest();
        }
      } else if ('finish' in command) {
        process.stdout.write('\nGeneration complete!\n');
        process.stdout.write(command.finish);
        return true;
      }
    }
    return false;
  }

  preload(): Promise<Anthropic.Messages.MessageParam[]> {
    return Promise.all(this.specContent.map((clause: string|object) => {
      if(typeof(clause) === 'string') return Promise.resolve({ role: 'user', content: clause });
      if('import' in clause && typeof(clause.import) === 'string') {
        return fs.readFile(clause.import).then(buffer => ({
          role: 'user', content: buffer.toString('base64')
        }))
      }
    }));
  }
  
  async generate() {
    let finished = false;
    let errors: string[] = [];
    
    while (!finished) {
      const preloads = await this.preload();
      try {
        const fixes = errors.map<Anthropic.Messages.MessageParam>(error => ({ role: 'user', content: `Be sure to fix this error: ${error}` }));
        const response = await anthropic.messages.create({
          model: 'claude-3-opus-20240229',
          max_tokens: 4096,
          messages: [...preloads, { role: 'user', content: `
Current manifest:
${JSON.stringify(this.manifest, null, 2)}

Your next response must be entirely in well-formed JSON format.

Continue generating project files. Start by picking just one file to generate (or update). Skip any that are already marked in the manifest as generated.` }, 
          ...fixes, { role: 'user', content: `Organize your reponse as a queue of command objects:
- If in order to comlpete the project, you need to add a file to the manifest, then queue an ADD command with format: { add: { path: 'path of file to be added', description: 'description of the file to be added' } }
- If in order to comlpete the project, you need to generate or update a file already listed as generated in the manifest, then queue an UPDATE command with format: { update: { path: 'path of file to be added', content: 'contents of generated file', why: 'reason why file is being updated' } }
- If in order to comlpete the project, you need to remove a file already in the manifest, then queue a REMOVE command with format: { remove: { path: 'path of file to be added' } }
- If in order to comlpete the project, you determine there are absolutely no more files to be added, updated, or removed, then queue a FINISH command with format: { finish: 'final report once no more files need to be added, updated, or removed' }

Include file contents in UPDATE commands.

Your response must not contain any FINISH command if you know there are more files to be added, updated, or removed.

Respond with a JSON array of command objects (of type ADD, or UPDATE, or REMOVE, or FINISH) with one the specific formats described above.

Your response must contain only the JSON array of commands, with no formatting or additional explanation.` }]
        });

        const content = response.content[0].text;
        const commands: Command[] = JSON.parse(content);
        finished = await this.processCommands(commands);
      } catch (error) {
        if(errors.length > 0) {
          console.error('Failure:', [ ...errors, error ]);
          process.exit(1);
        } else {
          console.log(error);
          errors = `${error}`.split('\n');
        }
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