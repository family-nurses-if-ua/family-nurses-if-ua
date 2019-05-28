/*TBJ, i probably should've used gcc's linker in some way. IDK why i didn't
consider that option. It is more advanced, has #define and #ifdef and other
lovely goodness. That said, this was a nice little learning experience. Also
this tool works, so why bother switching over now
*/

var startTime = process.hrtime();

const fs = require('fs');
const fileReader = require('readline');

var availableCommands = {};
var preprocessorCommands = {};

preprocessorCommands["skipLine"] = function(args, options, context){
  context.preprocessor.jump = {
    to: context.preprocessor.currentLine+1
  }
}

preprocessorCommands["ifflag"] = function(args, options, context){
  if(!context.flags[args[0]]){
    context.preprocessor.jump = {
      to: context.preprocessor.currentLine+1
    }
  }
}

preprocessorCommands["setwriting"] = function(args, options, context){
  context.preprocessor.writing = args[0] == "true";
}

preprocessorCommands["echo"] = function(args, options, context){
  console.log(args[0]);
}

preprocessFile = function(input, options, context){
  var marker = context.preprocessor.commandMarker;
  if(marker==null){
    //TODO: should throw an exception here tbh. Too lazy to implement custom exc
    context.error = "Preprocessor: commandMarker is null";
    return;
  }
  context.preprocessor.writing = true;
  var lines = input.split("\r\n");//TODO: Linux LF
  var result = "";
  var j = 0;
  for(var i = 0; i<lines.length; i++){
    j++;
    if(context.preprocessor.jump!=null){
      i = context.preprocessor.jump.to;
      context.preprocessor.jump = null;
    }
    context.preprocessor.currentLine = i;
    if(j>context.preprocessor.maxIterationsPerLine*lines.length){
      context.error = "Preprocessor: too many iterations. \n"+
      ""+j+"/"+context.preprocessor.maxIterationsPerLine*lines.length;
      return;
    }
    if(lines[i].trim().startsWith(marker)){
      var cmd = lines[i].trim().substring(marker.length).split(/\s+/);
      cmd[0] = cmd[0].toLowerCase();
      if(preprocessorCommands[cmd[0]]!=null)
        preprocessorCommands[cmd[0]](cmd.slice(1),options,context);
      else{
        context.error = "No such command "+cmd[0];
      }
    }
    if(context.preprocessor.writing){
      result += lines[i]+"\r\n";
    }

  }
  return result;
}

availableCommands["includepreprocessed"] = function(args, options, context){
  //TODO: implement variables, conditional inclusion and all that crap
  var sourcename = "unknown"
  try{
    var sourcename = args[0];
    if(sourcename.startsWith("\\")){
      sourcename = context.currentDir + sourcename;
    }
    if(options.outputlogsources)
      context.compiled += "\r\n//"+sourcename;

    var s = "\r\n"+fs.readFileSync(sourcename, 'utf8')

    s = preprocessFile(s, options, context);

    context.compiled += s;
  }catch(e){
    if(options.outputlogerrors)
      context.compiled += "\r\n//includedefault: load failure. error: "+e.message;
    console.error("Could not include "+sourcename+": error - "+e.message)
    if(!options.ignoreincludefailures){
      logError("Include file failure. ",e,options);
      context.error = true;
      return;
    }
  }
}

availableCommands["includeraw"] = function(args, options, context){
  //TODO: implement variables, conditional inclusion and all that crap
  var sourcename = "unknown"
  try{
    var sourcename = args[0];
    if(sourcename.startsWith("\\")){
      sourcename = context.currentDir + sourcename;
    }
    if(options.outputlogsources)
      context.compiled += "\r\n//"+sourcename;

    var s = "\r\n"+fs.readFileSync(sourcename, 'utf8')
    context.compiled += s;
  }catch(e){
    if(options.outputlogerrors)
      context.compiled += "\r\n//includedefault: load failure. error: "+e.message;
    console.error("Could not include "+sourcename+": error - "+e.message)
    if(!options.ignoreincludefailures){
      logError("Include file failure. ",e,options);
      context.error = true;
      return;
    }
  }
}

availableCommands["writeandflush"] = function(args, options, context){
  fs.writeFileSync(context.outputFileName, context.compiled, 'utf8');
  context.compiled = "";
}

availableCommands["output"] = function(args, options, context){
  context.outputFileName = args[0];
}

availableCommands["resetworkdir"] = function(args, options, context){
  context.currentDir = __dirname;
}

availableCommands["preprocessorsetmarker"] = function(args, options, context){
  context.preprocessor.commandMarker = args[0]+" ";
}

availableCommands["setflag"] = function(args, options, context){
  if(args.length>1)
    context.flags[args[0]] = args[1] == "true";
  else
    context.flags[args[0]] = true;
}

availableCommands["cd"] = function(args, options, context){
  if(args.length>1&&args[1].toLowerCase() == "fromroot")
    availableCommands["resetworkdir"](args, options, context);
  context.currentDir = context.currentDir + "\\" + args[0];
}

availableCommands["ifflag"] = function(args, options, context){
  if(!context.flags[args[0]]){
    if(args[1]=="elsejump"){
      context.goto = context.labels[args[2]];
    }else{
      context.goto = context.currentLine+1;
    }
  }
}

availableCommands["echo"] = function(args, options, context){
  console.log(args[0]);
}

function logError(msg, e, options){
  console.error(msg+(options.stacktrace?"Here are the details:":
  "Use -stacktrace for additional error details"));
  if(options.stacktrace)
    console.error(e)
  else console.error(e.message);
}

function processCompileGuide(filename, options){
  var compileGuide = "";

  //Try opening the compileguide and extracting its contents.
  try{
    compileGuide = fs.readFileSync(filename, 'utf8')
  }catch(e){
    logError("Compileguide read failure. ",e,options);
    return;
  }

  //Context objects keeps track of all the important things during execution.
  //It can be edited from within compileguide and is completely mutable
  var context = {
    currentDir: __dirname,
    flags: options.inputFlags,
    preprocessor: {
      maxIterationsPerLine: 1000
    },
    labels: {}
  };

  //Split the file into lines(Windows CRLF only for now)
  var lines = compileGuide.split("\r\n"); //TODO: Linux LF

  /* Remove all the junk lines(whitespace, comments) and simultaneously compose
  lines into commands.
  Syntax:
  #DOTHING ARG1 ARG2    - command
  |ARG3 ARG4            - continuation of previous command
  \dir1\dir2\file.ext   - basic file import
  /this is a comment    - comment
                        - whitespace
  */
  var commands = [];
  for(var i = 0; i<lines.length; i++){
    var ltrimmed = lines[i].trim();
    //If the line is empty(or was filled with whitespace), well... there's nothing
    //to parse
    if(ltrimmed.length<1) continue;
    //If the line is a comment, just skip it right away.
    if(ltrimmed[0]=='/') continue;
    //Otherwise, parse the line
    switch(ltrimmed[0]){
      case '#':
        commands.push(ltrimmed.substring(1));
        break;
      case '|':
        commands[commands.length]+=" "+ltrimmed.substring(1);
        break;
      case ':':
        context.labels[ltrimmed.substring(1)] = commands.length-1;
        break;
      default:
        commands.push("includeraw "+ltrimmed);
        break;
    }
  }

  if(options.showcommands){
    for(var i = 0; i<commands.length; i++){
      console.log(commands[i]);
    }
  }

  if(options.justparse){
    return;
  }

  context.compiled = "";

  //TODO: execute all commands here

  for(var i = 0; i<commands.length; i++){
    context.currentLine = i;
    //Split the command into tokens using whitespace as the delimeter
    var tokens = commands[i].split(/\s+/)
    tokens[0] = tokens[0].toLowerCase();
    //Attempt to execute the command
    if(availableCommands[tokens[0]]!=null){
      try{
        availableCommands[tokens[0]](tokens.slice(1),options,context);
        if(options.logexecution){
          console.log(commands[i]);
        }
      }catch(e){
        logError("Execution failure @"+tokens[0]+".",e,options);
        return;
      }
    }else{
      console.error("Unknown command: "+tokens[0]+"\n"+
      "Could not execute: command not found.");
      return;
    }

    if(context.error!=null){
      console.error("Last command reported an error. Aborting compilation. \n"+context.error
      );
      return;
    }

    if(context.goto!=null){
      i = context.goto;
      if(options.logexecution){
        console.log("goto "+(i+1));
      }
      context.goto = null;
    }
  }

  if(context.outputFileName==null){
    console.error("Failure: no output filename specified.\n"+
    "Add an Output command to your compileguide:\n"+
    "#Output \\path\\to\\outputFile.txt");
    return;
  }

  if(options.override||!fs.existsSync(context.outputFileName)){
    try{
      fs.writeFileSync(context.outputFileName, context.compiled, 'utf8');
      var timeItTook = process.hrtime(startTime);
      var timeMiliseconds = (timeItTook[0]*1000+timeItTook[1]/1000000).toFixed(4);
      console.log("Successful compilation. "+timeMiliseconds+"ms");
    }catch(e){
      logError("Output write failure. ",e,options);
      return;
    }
  }else{
    console.error("Failure: output file already exists.\n"+
    "If you'd like to override that file, please include the -override flag");
    return;
  }

}

function processArguments(arr){
  var options = {
    inputFlags: {}
  };
  for(var i = 0; i<arr.length; i++){
    var equalsIndex = arr[i].indexOf("=");
    if(equalsIndex>=0){
      switch(arr[i].substring(0,equalsIndex).toLowerCase()){
        case "setflag":
          options.inputFlags[arr[i].substring(equalsIndex+1)] = true;
          break;
        default:
          console.log("Unknown flag "+arr[i])
      }
    }else if(arr[i][0]=="-"){
      options[arr[i].substring(1).toLowerCase()] = true;
    }
  }
  return options;
}

if(process.argv.length<3){
  console.error("Expected 1 or more arguments.")
}else{
  var filename = process.argv[2];
  var options = processArguments(process.argv.slice(3));
  processCompileGuide(filename, options);
}
