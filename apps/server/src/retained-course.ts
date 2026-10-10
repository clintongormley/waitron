export const RETAINED_COURSE: unique symbol = Symbol("retainedCourse");

export type RetainedCourseLine = { [RETAINED_COURSE]?: true };
