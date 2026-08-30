export enum Command {
  WhoAmI = 0x01,
  OutputData = 0x02,
  OutputDataMax = 0x03,
  MahMwh = 0x04,
  Uptime = 0x05,
  OutputDataMaxReset = 0x06,
  InputType = 0x07,
  PdPdoFixed = 0x08,
  PdPdoPps = 0x09,
  PdPdo = 0x0a,
  PdPdoAvs = 0x0b,
  PdPdoNum = 0x0c,
  PdPdo2 = 0x0d,
  SystemReset = 0x40,
  SystemVersion = 0x42,
  SystemSerialNumber = 0x43,
  SystemFactoryReset = 0x45,
  SystemLcdPanelType = 0x46,
  SystemCurrentRshunt = 0x47,
  SystemCurrentOffset = 0x48,
  SystemIna226Config = 0x49
}

export const READ_FLAG = 0x80;
export const FRAME_TERMINATOR = 0x0a;

export const COMMAND_NAMES: Record<number, string> = {
  [Command.WhoAmI]: "CMD_WHO_AM_I",
  [Command.OutputData]: "CMD_OUTPUT_DATA",
  [Command.OutputDataMax]: "CMD_OUTPUT_DATA_MAX",
  [Command.MahMwh]: "CMD_MAH_MWH",
  [Command.Uptime]: "CMD_UPTIME",
  [Command.OutputDataMaxReset]: "CMD_OUTPUT_DATA_MAX_RESET",
  [Command.InputType]: "CMD_INPUT_TYPE",
  [Command.PdPdoFixed]: "CMD_PD_PDO_FIX",
  [Command.PdPdoPps]: "CMD_PD_PDO_PPS",
  [Command.PdPdo]: "CMD_PD_PDO",
  [Command.PdPdoAvs]: "CMD_PD_PDO_AVS",
  [Command.PdPdoNum]: "CMD_PD_PDO_NUM",
  [Command.PdPdo2]: "CMD_PD_PDO2",
  [Command.SystemReset]: "CMD_SYSTEM_RESET",
  [Command.SystemVersion]: "CMD_SYSTEM_VERSION",
  [Command.SystemSerialNumber]: "CMD_SYSTEM_SERIAL_NUM",
  [Command.SystemFactoryReset]: "CMD_SYSTEM_FACTORY_RESET",
  [Command.SystemLcdPanelType]: "CMD_SYSTEM_LCD_PANEL_TYPE",
  [Command.SystemCurrentRshunt]: "CMD_SYSTEM_CURRENT_RSHUNT",
  [Command.SystemCurrentOffset]: "CMD_SYSTEM_CURRENT_OFFSET",
  [Command.SystemIna226Config]: "CMD_SYSTEM_INA226_CONFIG"
};

// Full response lengths, including response head and final 0x0A/CRC byte.
export const FIXED_RESPONSE_LENGTHS: Record<number, number> = {
  [Command.OutputData]: 14,
  [Command.OutputDataMax]: 14,
  [Command.MahMwh]: 10,
  [Command.Uptime]: 6,
  [Command.InputType]: 3,
  [Command.PdPdo]: 5,
  [Command.PdPdoNum]: 5,
  [Command.PdPdo2]: 7,
  [Command.SystemLcdPanelType]: 3,
  [Command.SystemCurrentRshunt]: 3,
  [Command.SystemCurrentOffset]: 22,
  [Command.SystemIna226Config]: 5
};

export const VARIABLE_RESPONSE_COMMANDS = new Set<number>([
  Command.WhoAmI,
  Command.SystemVersion,
  Command.SystemSerialNumber,
  Command.PdPdoFixed,
  Command.PdPdoPps,
  Command.PdPdoAvs
]);

export const commandName = (command: number): string =>
  COMMAND_NAMES[command] ?? `CMD_0x${command.toString(16).padStart(2, "0")}`;

