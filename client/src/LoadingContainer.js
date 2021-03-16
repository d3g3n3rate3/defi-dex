import React, { useState, useEffect } from 'react';
import { getWeb3, getContracts } from './utils.js';
import App from './App.js';

function LoadingContainer() {
    const [web3, setWeb3] = useState(undefined);
    const [accounts, setAccounts] = useState([]);
    const [contracts, setContracts] = useState(undefined);

    // useEffect hook will be called only one time when the component first mounts
    useEffect(() => { // async/await do not work in the hook itself, so a new function needs to be declared inside the hook to use async/await
        const init = async () => {
            const web3 = await getWeb3();
            const contracts = await getContracts(web3);
            const accounts = await web3.eth.getAccounts();
            // set states
            setWeb3(web3);
            setContracts(contracts);
            setAccounts(accounts);
        }
        init();
    }, []);

    // utility function to tell us whether the component is ready or not
    const isReady = () => {
        return(
            typeof web3 !== 'undefined'
            && typeof contracts !== 'undefined'
            && accounts.length > 0
        );
    }
    // if component is not ready: display a loading screen
    if(!isReady()) {
        return <div>Loading...</div>;
    }
    return(
        <App web3={web3} contracts={contracts} accounts={accounts} />
    );
}

export default LoadingContainer;