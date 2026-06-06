module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__test__/**/*.test.js", "**/__test__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json", "node"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@features/(.*)$": "<rootDir>/src/features/$1",
    "^@middlewares/(.*)$": "<rootDir>/src/middlewares/$1",
    "^@routes/(.*)$": "<rootDir>/src/routes/$1",
    "^@types/(.*)$": "<rootDir>/src/types/$1",
    "^@config/(.*)$": "<rootDir>/src/config/$1",
    "^@utils/(.*)$": "<rootDir>/src/utils/$1",
    "^@lib/(.*)$": "<rootDir>/src/lib/$1",
  },
};
