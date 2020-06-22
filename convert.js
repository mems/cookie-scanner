const readStdin = require("get-stdin");
const args = require("command-line-args");

function escapeTag(str){
  //return str.replace(/[&<]/g, m => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#x27;", "/": "&#x2F;"})[m]);
  return str.replace(/[&<]/g, m => ({"&": "&amp;", "<": "&lt;"})[m]);
}

function writeCSV(buffer, data, fields){
  function line(fields){
    // Quote all field + escape quotes
    return fields.map(field => `"${field.replace(/"/g, "\"\"")}"`).join(", ") + "\n";
  }

  buffer.write(line(fields));

  for(const entry of data){
    buffer.write(line(fields.map(field => String(entry[field] || ""))));
  }
}

function writeHTML(buffer, data, fields){
  function line(fields, heading = false){
    const tag = heading ? "th" : "td";
    // Quote all field + escape special chars
    // https://www.bennadel.com/blog/1095-maintaining-line-breaks-in-an-html-excel-file.htm
    return `<tr>${fields.map(field => `<${tag}>${escapeTag(field).replace(/\r?\n/g, "<br style=\"mso-data-placement:same-cell;\" />")}</${tag}>`).join("")}</tr>\n`;
  }

  buffer.write("<html><body>\n<table>\n");
  buffer.write(line(fields, true));

  for(const entry of data){
    buffer.write(line(fields.map(field => String(entry[field] || ""))));
  }

  buffer.write("</table\n</body></html>\n");
}

function enumType(values, format){
  if(!new Set(values).has(format)){
    throw new Error(`Unknow value. Supported values: ${[...values].join(", ")}`);
  }

  return format;
}

(async () => {
  const {
    format,
    fields,
  } = args([
    {name: "format", type: enumType.bind(null, ["json", "html", "csv"]), defaultValue: "csv"},
    {name: "fields", multiple: true, defaultValue: ["name", "host", "path", "isSession", "isThirdParty", "lifeSpan", "initiator"]},
  ]);

  const cookies = JSON.parse(await readStdin());

  switch(format){
    case "json":
      return;// do nothing
    case "html":
      return writeHTML(process.stdout, cookies, fields);
    default:
      return writeCSV(process.stdout, cookies, fields);
  }
})();