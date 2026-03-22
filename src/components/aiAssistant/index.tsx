import { connect } from "react-redux";
import {
  handleAIPanelOpen,
  handleAIPanelLock,
  handleFetchPlugins,
} from "../../store/actions";
import { stateType } from "../../store";
import { withTranslation } from "react-i18next";
import AiAssistant from "./component";

const mapStateToProps = (state: stateType) => {
  return {
    originalText: state.reader.originalText,
    currentBook: state.book.currentBook,
    currentChapter: state.reader.currentChapter,
    htmlBook: state.reader.htmlBook,
    plugins: state.manager.plugins,
    isAIPanelOpen: state.reader.isAIPanelOpen,
    isAIPanelLocked: state.reader.isAIPanelLocked,
    backgroundColor: state.reader.backgroundColor,
    renderBookFunc: state.book.renderBookFunc,
  };
};

const actionCreator = {
  handleAIPanelOpen,
  handleAIPanelLock,
  handleFetchPlugins,
};

export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(AiAssistant as any) as any);
