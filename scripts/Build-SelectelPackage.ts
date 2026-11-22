import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deploymentFiles, inventory, makeManifest, sha256, uiAssetFiles, verifyRelease } from '../deploy/manage-release.ts';

const project = fileURLToPath(new URL('..', import.meta.url));
export function stageRelease(destination: string, options: { source?: string; candidate?: any } = {}) {
  const source = options.source ?? project;
  if (options.source && !options.candidate) throw new Error('Frozen source requires its candidate manifest.');
  if(options.candidate && (!/^[a-f0-9]{40}$/.test(options.candidate.head)||typeof options.candidate.source_dirty!=='boolean'||
      !options.candidate.source_files||JSON.stringify(inventory(source))!==JSON.stringify(options.candidate.source_files)))throw new Error('Candidate metadata or frozen source inventory mismatch.');
  if (options.candidate) for (const [file,hash] of Object.entries(options.candidate.source_files)) {
    if (file.split('/').includes('..') || /^(output|\.git)\//.test(file) || (file !== 'docs/handoff/ACCEPTANCE.md' && /(?:DELIVERY-MANIFEST|ACCEPTANCE|package-receipt)\./.test(file))) throw new Error('Post-build data cannot be a candidate input.');
    if (sha256(readFileSync(join(source,file))) !== hash) throw new Error('Frozen source mismatch: '+file);
  }
  const files = ['package.json', ...readdirSync(join(source, 'src')).filter((name) => name.endsWith('.ts')).map((name) => 'src/' + name),
    ...uiAssetFiles, ...deploymentFiles];
  mkdirSync(destination, { recursive: true });
  for (const file of files) {
    if (options.candidate && !Object.hasOwn(options.candidate.source_files,file)) throw new Error('Runtime file absent from candidate: '+file);
    mkdirSync(dirname(join(destination, file)), { recursive: true });
    // Shell scripts must stay LF even when assembled from a Windows checkout.
    if (/\.(ttf|png)$/.test(file)) copyFileSync(join(source, file), join(destination, file));
    else writeFileSync(join(destination, file), readFileSync(join(source, file), 'utf8').replaceAll('\r\n', '\n'));
  }
  let metadata=options.candidate;
  if(!metadata){
    try{metadata={head:execFileSync('git',['rev-parse','HEAD'],{cwd:project,encoding:'utf8',stdio:'pipe'}).trim(),source_dirty:execFileSync('git',['status','--porcelain'],{cwd:project,encoding:'utf8',stdio:'pipe'}).trim().length>0};}
    catch(error){const receipt=join(project,'../candidate.json');if(!existsSync(receipt))throw error;metadata=JSON.parse(readFileSync(receipt,'utf8'));
      if(JSON.stringify(inventory(project))!==JSON.stringify(metadata.source_files))throw new Error('Standalone source differs from its candidate manifest.');}
  }
  const commit = metadata.head, dirty = metadata.source_dirty;
  const manifest = makeManifest(destination, commit, dirty);
  verifyRelease(destination);
  return manifest;
}
if (import.meta.main) {
  const argument=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
  const source=argument('--source'), candidateFile=argument('--candidate');
  if(Boolean(source)!==Boolean(candidateFile))throw new Error('Use --source and --candidate together.');
  const candidate=candidateFile?JSON.parse(readFileSync(resolve(candidateFile),'utf8')):undefined;
  const output = resolve(project, 'output'); mkdirSync(output, { recursive: true });
  const stage = mkdtempSync(join(output, 'selectel-package-'));
  const manifest = stageRelease(join(stage, 'goulash-ads-update'),{source:source&&resolve(source),candidate});
  const archive = join(output, 'goulash-ads-update.tar.gz');
  const temporary = join(stage, 'goulash-ads-update.tar.gz');
  execFileSync('tar', ['-czf', temporary, '-C', stage, 'goulash-ads-update'], { stdio: 'pipe' });
  copyFileSync(temporary, archive);
  const checksum = sha256(readFileSync(archive));
  writeFileSync(archive + '.sha256', `${checksum}  goulash-ads-update.tar.gz\n`);
  if(source&&candidateFile){
    const sourceStage=join(stage,'goulash-ads-source');mkdirSync(sourceStage,{recursive:true});
    for(const file of Object.keys(candidate.source_files)){
      const target=join(sourceStage,'source',file);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(source,file),target);
    }
    copyFileSync(candidateFile,join(sourceStage,'candidate.json'));
    const sourceArchive=join(output,'goulash-ads-source.tar.gz');
    execFileSync('tar',['-czf',sourceArchive,'-C',stage,'goulash-ads-source'],{stdio:'pipe'});
    writeFileSync(sourceArchive+'.sha256',`${sha256(readFileSync(sourceArchive))}  goulash-ads-source.tar.gz\n`);
  }
  console.log(JSON.stringify({ archive, sha256: checksum, releaseId: manifest.releaseId, sourceCommit: manifest.sourceCommit, files: Object.keys(manifest.files).length }, null, 2));
}
