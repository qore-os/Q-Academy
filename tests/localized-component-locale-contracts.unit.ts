import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

import ts from "typescript";

const contracts = {
  "src/components/media/profile-media-asset-field.tsx": [
    "ProfileMediaAssetField",
  ],
  "src/components/media/image-asset-upload-field.tsx": [
    "ImageAssetUploadField",
  ],
  "src/components/auth/account-recovery-forms.tsx": [
    "InvitationAcceptForm",
    "PasswordForgotForm",
    "PasswordResetForm",
  ],
  "src/components/academy/submission-attachment-uploader.tsx": [
    "SubmissionAttachmentLinks",
    "SubmissionAttachmentUploader",
  ],
  "src/components/academy/submission-recorder.tsx": ["SubmissionRecorder"],
  "src/components/academy/video-transcript-player.tsx": [
    "VideoTranscriptPlayer",
  ],
  "src/components/admin/member-table.tsx": ["MemberTable"],
  "src/components/admin/owner-step-up-control.tsx": ["OwnerStepUpControl"],
  "src/components/admin/rich-text-editor.tsx": ["RichTextEditor"],
  "src/components/admin/admin-create-dialog.tsx": ["AdminCreateButton"],
} as const;

const localizedComponents: ReadonlySet<string> = new Set(
  Object.values(contracts).flatMap((names) => [...names]),
);

function sourceFile(path: string) {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.isFile() && path.endsWith(".tsx") ? [path] : [];
  });
}

test("localized component contracts require an explicit AppLocale", () => {
  for (const [path, componentNames] of Object.entries(contracts)) {
    const file = sourceFile(path);
    const functions = new Map<string, ts.FunctionDeclaration>();
    for (const statement of file.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name) {
        functions.set(statement.name.text, statement);
      }
    }

    for (const componentName of componentNames) {
      const component = functions.get(componentName);
      assert.ok(component, `${path} must declare ${componentName}`);
      const parameter = component.parameters[0];
      assert.ok(
        parameter && ts.isObjectBindingPattern(parameter.name),
        `${componentName} must use an object props parameter`,
      );
      const localeBinding = parameter.name.elements.find(
        (element) => element.name.getText(file) === "locale",
      );
      assert.ok(localeBinding, `${componentName} must destructure locale`);
      assert.equal(
        localeBinding.initializer,
        undefined,
        `${componentName} must not default locale`,
      );

      assert.ok(
        parameter.type && ts.isTypeLiteralNode(parameter.type),
        `${componentName} must declare its props type`,
      );
      const localeProperty = parameter.type.members.find(
        (member): member is ts.PropertySignature =>
          ts.isPropertySignature(member) &&
          member.name.getText(file) === "locale",
      );
      assert.ok(localeProperty, `${componentName} must type locale`);
      assert.equal(
        localeProperty.questionToken,
        undefined,
        `${componentName} locale must be required`,
      );
      assert.equal(
        localeProperty.type?.getText(file),
        "AppLocale",
        `${componentName} locale must use AppLocale`,
      );
    }
  }
});

test("every localized component caller provides locale", () => {
  const invocationCounts = new Map<string, number>();
  const missing: string[] = [];

  for (const path of tsxFiles("src")) {
    const file = sourceFile(path);
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = node.tagName.getText(file);
        if (localizedComponents.has(name)) {
          invocationCounts.set(name, (invocationCounts.get(name) ?? 0) + 1);
          const hasLocale = node.attributes.properties.some(
            (attribute) =>
              ts.isJsxAttribute(attribute) &&
              attribute.name.getText(file) === "locale",
          );
          if (!hasLocale) {
            const location = file.getLineAndCharacterOfPosition(node.getStart(file));
            missing.push(
              `${relative(process.cwd(), path)}:${location.line + 1} <${name}>`,
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  assert.deepEqual(missing, []);
  for (const componentName of localizedComponents) {
    assert.ok(
      (invocationCounts.get(componentName) ?? 0) > 0,
      `${componentName} must have a checked JSX caller`,
    );
  }
});
