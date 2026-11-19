// Who this app is on the computer. Every name it registers there (the startup entry, Desktop and menu shortcuts, the
// macOS launch agent, the install marker, Claude's MCP server, the skill and the rule block in the agent's rules file)
// and its default port come from here, so Edit Hub and VideoHub can be installed side by side without overwriting each
// other. Not here on purpose: the `.videohub` folder inside each film (the film format) and the VIDEOHUB_* variables.
export const APP = 'Edit Hub';   // the name people read
export const ID = 'edithub';     // MCP server, skill, rule markers, ping, launch agent label
export const FILE = 'EditHub';   // file and registry names: shortcut, startup entry, install marker, workspace folder
export const PORT = 7790;        // VideoHub keeps 7788
