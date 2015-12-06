'use strict';
var React = require('react');
var FullScreenButton = React.createClass({
    propTypes: {
        terria: React.PropTypes.object
    },

    getInitialState: function() {
        return {
            isActive: false
        };
    },

    toggleFullScreen: function(e){
        var body = document.body;
        this.setState({
          isActive : !this.state.isActive
        });

        body.classList.toggle('is-full-screen', !this.state.isActive);
        this.props.terria.currentViewer.notifyRepaintRequired();
    },

    render: function() {
        return <div><button onClick={this.toggleFullScreen} title='go to full screen mode' className={'btn btn-map btn-full-screen ' + (this.state.isActive ? 'is-active' : '')}><i className='icon icon-full-screen'></i></button></div>;
    }
});
module.exports = FullScreenButton;
