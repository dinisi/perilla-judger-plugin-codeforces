const judge = require("../dist");
const { join } = require("path");

console.log("Start test...");

judge(
    {
        id: '1091A'
    },
    {
        file: 1,
        language: "cpp17"
    },
    (id) => ({
        path: join(__dirname, "" + id),
        info: {}
    }),
    (solution) => console.log(solution)
);