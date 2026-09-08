/** Experimental-package publication and dependency constraints. */

import { describe, expect, it } from 'vitest'
import manturManifest from '../packages/bundle/mantur-app/package.json' with { type: 'json' }
import editingManifest from '../packages/client/ui-mantur-editing/package.json' with { type: 'json' }
import {
  checkExperimentalDependencyIsolation,
  checkExperimentalManifest,
  checkWorkspaceManifest,
  expectedDshPackageFiles,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'

const experimental: WorkspaceManifest = {
  dir: 'packages/experimental/prototype',
  manifest: { name: '@deepseek-ai/dsh-experimental-prototype', private: true },
}

describe('experimental workspace constraints', () => {
  it('requires the experimental package-name prefix', () => {
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, name: '@deepseek-ai/dsh-prototype' },
    })).toEqual([
      '@deepseek-ai/dsh-prototype: experimental package name must start with "@deepseek-ai/dsh-experimental-"',
    ])
  })

  it('requires private manifests without publication metadata', () => {
    expect(checkExperimentalManifest(experimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, private: false, publishConfig: { access: 'public' } },
    })).toEqual([
      '@deepseek-ai/dsh-experimental-prototype: experimental package must set "private": true',
      '@deepseek-ai/dsh-experimental-prototype: experimental package must omit publishConfig',
    ])
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects release %s on an experimental package',
    (section) => {
      expect(checkExperimentalDependencyIsolation([experimental, {
        dir: 'packages/core/consumer',
        manifest: {
          name: '@deepseek-ai/dsh-consumer',
          [section]: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
        },
      }])).toEqual([
        `@deepseek-ai/dsh-consumer: ${section}.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package`,
      ])
    },
  )

  it('allows development and experimental consumers but rejects the Python release runtime', () => {
    const manifests: WorkspaceManifest[] = [experimental, {
      dir: 'packages/core/test-only',
      manifest: {
        name: '@deepseek-ai/dsh-test-only',
        devDependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'packages/experimental/consumer',
      manifest: {
        name: '@deepseek-ai/dsh-experimental-consumer',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'python/sdk-runtime',
      manifest: {
        name: '@deepseek-ai/dsh-python-runtime',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }]

    expect(checkExperimentalDependencyIsolation(manifests)).toEqual([
      '@deepseek-ai/dsh-python-runtime: dependencies.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package',
    ])
  })
})

describe('package payload constraints', () => {
  it('ships the bundled editing types entry without private browser compiler output', () => {
    const manifest = { ...editingManifest, dsh: {} }
    const workspace: WorkspaceManifest = { dir: 'packages/client/ui-mantur-editing', manifest }
    expect(checkWorkspaceManifest(workspace)).toEqual([])
    for (const files of [
      editingManifest.files.filter(file => file !== 'lib/types.js'),
      [...editingManifest.files, 'lib/types/**/*.js'],
    ]) {
      expect(checkWorkspaceManifest({ ...workspace, manifest: { ...manifest, files } }))
        .toEqual([expect.stringContaining('package.json files must be')])
    }
  })

  it('requires both Mantur update entries and rejects an unrelated published artifact', () => {
    const workspace: WorkspaceManifest = { dir: 'packages/bundle/mantur-app', manifest: manturManifest }
    expect(checkWorkspaceManifest(workspace)).toEqual([])
    for (const files of [
      manturManifest.files.filter(file => file !== 'lib/update-protocol.js'),
      manturManifest.files.filter(file => file !== 'lib/update-shutdown.js'),
      [...manturManifest.files, 'lib/unrelated.js'],
    ]) {
      expect(checkWorkspaceManifest({ ...workspace, manifest: { ...manturManifest, files } }))
        .toEqual([expect.stringContaining('package.json files must be')])
    }
  })

  it('keeps the native desktop assembly private and outside npm publication policy', () => {
    const desktop: WorkspaceManifest = {
      dir: 'apps/desktop',
      manifest: { name: '@deepseek-ai/dsh-desktop', private: true },
    }

    expect(checkWorkspaceManifest(desktop)).toEqual([])
    expect(checkWorkspaceManifest({
      ...desktop,
      manifest: { ...desktop.manifest, private: false },
    })).toEqual([
      'apps/desktop/package.json: @deepseek-ai/dsh-desktop: package.json must set "private": true',
    ])
    expect(checkWorkspaceManifest({
      ...desktop,
      manifest: { ...desktop.manifest, publishConfig: { access: 'public' } },
    })).toEqual([
      'apps/desktop/package.json: @deepseek-ai/dsh-desktop: private application must omit publishConfig',
    ])
  })

  it('ships the external editor theme module and its declaration', () => {
    expect(expectedDshPackageFiles({
      name: '@deepseek-ai/dsh-client-ui-mantur-editing',
      exports: { './client': { default: './lib/client.js' } },
    })).toEqual([
      'lib/index.js',
      'lib/client.js',
      'adapters/openchatcut-theme.mjs',
      'adapters/openchatcut-theme.d.mts',
      'adapters/mantur-cut.patch', 'adapters/mantur-runtime.mjs',
      'adapters/mantur-runtime-shutdown.mjs',
      'adapters/mantur-production-runtime.mjs', 'adapters/mantur-packaged-resources.mjs',
      'adapters/mantur-packaged-resources.d.mts', 'adapters/mantur-cut-packaged.patch',
      'adapters/mantur-cut-shutdown.patch',
      'lib/types/**/*.d.ts',
    ])
  })

  it('includes a declared profile patch without a package-name allowlist', () => {
    expect(expectedDshPackageFiles({
      name: '@deepseek-ai/dsh-private-profile',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })).toEqual([
      'lib/index.js',
      'cordis.patch.yml',
      'lib/types/**/*.d.ts',
    ])
  })
})
