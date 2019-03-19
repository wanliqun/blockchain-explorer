/**
 *    SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { withStyles } from '@material-ui/core/styles';
import clientJson from '../../../package.json';
import Version from '../../FabricVersion';

const styles = theme => {
  const { type } = theme.palette;
  const dark = type === 'dark';
  return {
    root: {
      margin: '2%',
      height: '5px'
    },
    footer: {
      backgroundColor: dark ? '#5e558e' : '#e8e8e8',
      color: dark ? '#ffffff' : undefined,
      textAlign: 'center',
      position: 'fixed',
      left: 0,
      right: 0,
      bottom: 0
    }
  };
};

const FooterView = ({ classes }) => (
  <div className={classes.root}>
    <div>
      <div className={classes.footer}>
        {
          'Copyright © 2018-2019  北京深安未来科技有限公司 - Deepchain区块链浏览器系统 V1.0'
        }
        &emsp;
      </div>
    </div>
  </div>
);

export default withStyles(styles)(FooterView);
