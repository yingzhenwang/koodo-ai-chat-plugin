import React from "react";
import { SettingInfoProps, SettingInfoState } from "./interface";
import { Trans } from "react-i18next";
import _ from "underscore";
import { themeList } from "../../../constants/themeList";
import toast from "react-hot-toast";
import {
  checkPlugin,
  getWebsiteUrl,
  handleContextMenu,
  openExternalUrl,
} from "../../../utils/common";
import { getStorageLocation } from "../../../utils/common";
import DatabaseService from "../../../utils/storage/databaseService";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { isElectron } from "react-device-detect";
import { testConnection } from "../../../utils/aiProvider";
declare var global: any;

const AI_PROVIDER_DEFAULTS: Record<
  string,
  { baseUrl: string; model: string; displayName: string }
> = {
  openai: {
    baseUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-5.4-mini",
    displayName: "OpenAI GPT",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-20250514",
    displayName: "Anthropic Claude",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
    displayName: "DeepSeek",
  },
  custom: {
    baseUrl: "",
    model: "",
    displayName: "Custom AI",
  },
};

class SettingDialog extends React.Component<
  SettingInfoProps,
  SettingInfoState
> {
  constructor(props: SettingInfoProps) {
    super(props);
    this.state = {
      isPreventTrigger:
        ConfigService.getReaderConfig("isPreventTrigger") === "yes",
      isPreventAdd: ConfigService.getReaderConfig("isPreventAdd") === "yes",
      isDisablePopup: ConfigService.getReaderConfig("isDisablePopup") === "yes",
      isDeleteShelfBook:
        ConfigService.getReaderConfig("isDeleteShelfBook") === "yes",
      isHideShelfBook:
        ConfigService.getReaderConfig("isHideShelfBook") === "yes",
      isOpenInMain: ConfigService.getReaderConfig("isOpenInMain") === "yes",
      isPrecacheBook: ConfigService.getReaderConfig("isPrecacheBook") === "yes",
      appSkin: ConfigService.getReaderConfig("appSkin"),
      isUseBuiltIn: ConfigService.getReaderConfig("isUseBuiltIn") === "yes",
      isDisablePDFCover:
        ConfigService.getReaderConfig("isDisablePDFCover") === "yes",
      currentThemeIndex: _.findLastIndex(themeList, {
        name: ConfigService.getReaderConfig("themeColor"),
      }),
      storageLocation: getStorageLocation() || "",
      isAddNew: false,
      settingLogin: "",
      driveConfig: {},
      loginConfig: {},
      isAddAI: false,
      aiProvider: "openai",
      aiApiKey: "",
      aiBaseUrl: AI_PROVIDER_DEFAULTS.openai.baseUrl,
      aiModel: AI_PROVIDER_DEFAULTS.openai.model,
      aiSystemPrompt: "",
      isTesting: false,
    };
  }

  handleRest = (_bool: boolean) => {
    toast.success(this.props.t("Change successful"));
  };
  handleSetting = (stateName: string) => {
    this.setState({ [stateName]: !this.state[stateName] } as any);
    ConfigService.setReaderConfig(
      stateName,
      this.state[stateName] ? "no" : "yes"
    );
    this.handleRest(this.state[stateName]);
  };

  handleAIProviderChange = (provider: string) => {
    const defaults = AI_PROVIDER_DEFAULTS[provider] || AI_PROVIDER_DEFAULTS.custom;
    this.setState({
      aiProvider: provider,
      aiBaseUrl: defaults.baseUrl,
      aiModel: defaults.model,
    });
  };

  handleTestConnection = async () => {
    if (!this.state.aiApiKey) {
      toast.error(this.props.t("Please enter API Key"));
      return;
    }
    this.setState({ isTesting: true });
    try {
      await testConnection({
        provider: this.state.aiProvider as any,
        apiKey: this.state.aiApiKey,
        baseUrl: this.state.aiBaseUrl,
        model: this.state.aiModel,
      });
      toast.success(this.props.t("Connection successful"));
    } catch (err: any) {
      toast.error(
        this.props.t("Connection failed") + ": " + (err.message || err)
      );
    } finally {
      this.setState({ isTesting: false });
    }
  };

  handleSaveAIPlugin = async () => {
    if (!this.state.aiApiKey) {
      toast.error(this.props.t("Please enter API Key"));
      return;
    }
    if (!this.state.aiBaseUrl) {
      toast.error(this.props.t("Please enter API Base URL"));
      return;
    }

    const defaults =
      AI_PROVIDER_DEFAULTS[this.state.aiProvider] || AI_PROVIDER_DEFAULTS.custom;
    const pluginKey = this.state.aiProvider + "-chat-plugin";

    const plugin = {
      key: pluginKey,
      identifier: pluginKey,
      type: "assistant",
      displayName: defaults.displayName,
      icon: "chat",
      version: "1.0.0",
      autoValue: "",
      config: {
        provider: this.state.aiProvider,
        apiKey: this.state.aiApiKey,
        baseUrl: this.state.aiBaseUrl,
        model: this.state.aiModel,
        systemPrompt: this.state.aiSystemPrompt,
      },
      langList: [],
      voiceList: [],
      scriptSHA256: "",
      script: "",
    };

    if (this.props.plugins.find((item) => item.key === pluginKey)) {
      await DatabaseService.updateRecord(plugin, "plugins");
    } else {
      await DatabaseService.saveRecord(plugin, "plugins");
    }

    ConfigService.setReaderConfig("aiService", pluginKey);
    this.props.handleFetchPlugins();
    toast.success(this.props.t("Addition successful"));
    this.setState({
      isAddAI: false,
      aiApiKey: "",
      aiSystemPrompt: "",
    });
  };

  renderAIForm = () => {
    const inputStyle: React.CSSProperties = {
      width: "100%",
      padding: "6px 10px",
      border: "1px solid rgba(128,128,128,0.3)",
      borderRadius: "6px",
      fontSize: "13px",
      background: "transparent",
      color: "inherit",
      boxSizing: "border-box",
      fontFamily: "inherit",
    };
    const labelStyle: React.CSSProperties = {
      fontSize: "13px",
      fontWeight: 500,
      marginBottom: "4px",
      display: "block",
    };
    const rowStyle: React.CSSProperties = {
      marginBottom: "12px",
    };

    return (
      <div
        style={{
          margin: "10px 25px",
          padding: "15px",
          border: "1px solid rgba(128,128,128,0.2)",
          borderRadius: "8px",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: "14px", fontSize: "14px" }}>
          <Trans>Add AI Assistant</Trans>
        </div>

        <div style={rowStyle}>
          <label style={labelStyle}>
            <Trans>AI Provider</Trans>
          </label>
          <select
            style={{ ...inputStyle, cursor: "pointer" }}
            value={this.state.aiProvider}
            onChange={(e) => this.handleAIProviderChange(e.target.value)}
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="deepseek">DeepSeek</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        <div style={rowStyle}>
          <label style={labelStyle}>
            <Trans>API Key</Trans>
          </label>
          <input
            type="password"
            style={inputStyle}
            placeholder="sk-..."
            value={this.state.aiApiKey}
            onChange={(e) => this.setState({ aiApiKey: e.target.value })}
          />
        </div>

        <div style={rowStyle}>
          <label style={labelStyle}>
            <Trans>API Base URL</Trans>
          </label>
          <input
            type="text"
            style={inputStyle}
            value={this.state.aiBaseUrl}
            onChange={(e) => this.setState({ aiBaseUrl: e.target.value })}
          />
        </div>

        <div style={rowStyle}>
          <label style={labelStyle}>
            <Trans>Model</Trans>
          </label>
          <input
            type="text"
            style={inputStyle}
            value={this.state.aiModel}
            onChange={(e) => this.setState({ aiModel: e.target.value })}
          />
        </div>

        <div style={rowStyle}>
          <label style={labelStyle}>
            <Trans>System Prompt</Trans>{" "}
            <span style={{ opacity: 0.5, fontWeight: 400 }}>
              (<Trans>Optional</Trans>)
            </span>
          </label>
          <textarea
            style={{
              ...inputStyle,
              height: "60px",
              resize: "vertical",
            }}
            placeholder={this.props.t(
              "Custom system prompt, supports {bookTitle} {bookAuthor} {chapterTitle} {selectedText} {surroundingText} variables"
            )}
            value={this.state.aiSystemPrompt}
            onChange={(e) =>
              this.setState({ aiSystemPrompt: e.target.value })
            }
          />
        </div>

        <div
          style={{
            display: "flex",
            gap: "8px",
            justifyContent: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <div
            className="voice-add-cancel"
            onClick={() => this.setState({ isAddAI: false })}
          >
            <Trans>Cancel</Trans>
          </div>
          <div
            className="voice-add-cancel"
            style={{
              color: this.state.isTesting ? "gray" : "#f16464",
              cursor: this.state.isTesting ? "default" : "pointer",
            }}
            onClick={this.handleTestConnection}
          >
            {this.state.isTesting ? (
              <Trans>Testing...</Trans>
            ) : (
              <Trans>Test Connection</Trans>
            )}
          </div>
          <div className="voice-add-confirm" onClick={this.handleSaveAIPlugin}>
            <Trans>Confirm</Trans>
          </div>
        </div>
      </div>
    );
  };

  render() {
    return (
      <>
        {this.props.plugins &&
          (this.props.plugins.length === 0 || this.state.isAddNew) && (
            <div
              className="voice-add-new-container"
              style={{
                marginLeft: "25px",
                width: "calc(100% - 50px)",
                fontWeight: 500,
              }}
            >
              <textarea
                name="url"
                placeholder={this.props.t(
                  "Paste the code of the plugin here, check out document to learn how to get more plugins"
                )}
                id="voice-add-content-box"
                className="voice-add-content-box"
                onContextMenu={() => {
                  handleContextMenu("voice-add-content-box");
                }}
              />
              <div className="token-dialog-button-container">
                <div
                  className="voice-add-confirm"
                  onClick={async () => {
                    let value: string = (
                      document.querySelector(
                        "#voice-add-content-box"
                      ) as HTMLTextAreaElement
                    ).value;
                    if (value) {
                      let plugin = JSON.parse(value);
                      plugin.key = plugin.identifier;
                      if (!(await checkPlugin(plugin))) {
                        toast.error(this.props.t("Plugin verification failed"));
                        return;
                      }
                      if (plugin.type === "voice" && !isElectron) {
                        toast.error(
                          this.props.t(
                            "Only desktop version supports TTS plugin"
                          )
                        );
                        return;
                      }
                      if (
                        plugin.type === "voice" &&
                        plugin.voiceList.length === 0
                      ) {
                        let voiceFunc = plugin.script;
                        // eslint-disable-next-line no-eval
                        eval(voiceFunc);
                        plugin.voiceList = await global.getTTSVoice(
                          plugin.config
                        );
                      }
                      if (
                        this.props.plugins.find(
                          (item) => item.key === plugin.key
                        )
                      ) {
                        await DatabaseService.updateRecord(plugin, "plugins");
                      } else {
                        await DatabaseService.saveRecord(plugin, "plugins");
                      }
                      this.props.handleFetchPlugins();
                      toast.success(this.props.t("Addition successful"));
                    }
                    this.setState({ isAddNew: false });
                  }}
                >
                  <Trans>Confirm</Trans>
                </div>
                <div className="voice-add-button-container">
                  <div
                    className="voice-add-cancel"
                    onClick={() => {
                      this.setState({ isAddNew: false });
                    }}
                  >
                    <Trans>Cancel</Trans>
                  </div>
                  <div
                    className="voice-add-cancel"
                    style={{ marginRight: "10px" }}
                    onClick={() => {
                      if (
                        ConfigService.getReaderConfig("lang") &&
                        ConfigService.getReaderConfig("lang").startsWith("zh")
                      ) {
                        openExternalUrl(getWebsiteUrl() + "/zh/plugin");
                      } else {
                        openExternalUrl(getWebsiteUrl() + "/en/plugin");
                      }
                    }}
                  >
                    <Trans>Document</Trans>
                  </div>
                </div>
              </div>
            </div>
          )}

        {this.state.isAddAI && this.renderAIForm()}

        {this.props.plugins &&
          this.props.plugins.map((item) => {
            return (
              <div className="setting-dialog-new-title" key={item.key}>
                <span>
                  <span
                    className={`icon-${
                      item.type === "dictionary"
                        ? "dict"
                        : item.type === "voice"
                          ? "speaker"
                          : item.type === "translation"
                            ? "translation"
                            : "ai-assist"
                    } setting-plugin-icon`}
                  ></span>
                  <span className="setting-plugin-name">
                    {this.props.t(item.displayName)}
                  </span>
                </span>

                {!item.key.startsWith("official") && (
                  <span
                    className="change-location-button"
                    onClick={async () => {
                      await DatabaseService.deleteRecord(item.key, "plugins");
                      this.props.handleFetchPlugins();
                      toast.success(this.props.t("Deletion successful"));
                    }}
                  >
                    <Trans>Delete</Trans>
                  </span>
                )}
              </div>
            );
          })}

        {this.props.plugins && this.props.plugins.length > 0 && (
          <>
            {!this.state.isAddAI && (
              <div
                className="setting-dialog-new-plugin"
                style={{ fontWeight: "bold", color: "#f16464", bottom: "50px" }}
                onClick={() => {
                  this.setState({ isAddAI: true });
                }}
              >
                <Trans>Add AI Assistant</Trans>
              </div>
            )}
            <div
              className="setting-dialog-new-plugin"
              style={{ fontWeight: "bold" }}
              onClick={async () => {
                this.setState({ isAddNew: true });
              }}
            >
              <Trans>Add new plugin</Trans>
            </div>
          </>
        )}

        {this.props.plugins && this.props.plugins.length === 0 && !this.state.isAddNew && (
          <>
            {!this.state.isAddAI && (
              <div
                className="setting-dialog-new-plugin"
                style={{ fontWeight: "bold", color: "#f16464" }}
                onClick={() => {
                  this.setState({ isAddAI: true });
                }}
              >
                <Trans>Add AI Assistant</Trans>
              </div>
            )}
          </>
        )}
      </>
    );
  }
}

export default SettingDialog;
