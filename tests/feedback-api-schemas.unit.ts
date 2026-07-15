import assert from "node:assert/strict";
import test from "node:test";
import {
  feedbackCreateSchema,
  feedbackUpdateSchema,
} from "../src/lib/api/schemas";

const userId = "00000000-0000-4000-8000-000000000001";
const courseId = "00000000-0000-4000-8000-000000000002";
const lessonId = "00000000-0000-4000-8000-000000000003";

test("lesson feedback accepts a rating without an optional comment", () => {
  const parsed = feedbackCreateSchema.parse({
    userId,
    courseId,
    lessonId,
    type: "lesson",
    rating: 4,
    content: "",
  });
  assert.equal(parsed.content, "");
});

test("lesson feedback requires its course and lesson context", () => {
  assert.equal(
    feedbackCreateSchema.safeParse({
      userId,
      type: "lesson",
      rating: 4,
      content: "",
    }).success,
    false,
  );
});

test("course feedback requires its course context", () => {
  assert.equal(
    feedbackCreateSchema.safeParse({
      userId,
      type: "course",
      rating: 4,
      content: "Hilfreicher Kurs",
    }).success,
    false,
  );
  assert.equal(
    feedbackCreateSchema.safeParse({
      userId,
      courseId,
      type: "course",
      rating: 4,
      content: "Hilfreicher Kurs",
    }).success,
    true,
  );
});

test("non-lesson feedback keeps the existing minimum text length", () => {
  assert.equal(
    feedbackCreateSchema.safeParse({
      userId,
      type: "platform",
      rating: 4,
      content: "",
    }).success,
    false,
  );
});

test("feedback status updates derive the reviewer and reject body impersonation", () => {
  assert.deepEqual(feedbackUpdateSchema.parse({ status: "reviewed" }), {
    status: "reviewed",
  });
  assert.equal(
    feedbackUpdateSchema.safeParse({
      status: "reviewed",
      reviewerId: userId,
    }).success,
    false,
  );
});
